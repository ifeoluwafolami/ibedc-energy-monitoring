import { Workbook, Worksheet } from 'exceljs';
import { Request, Response } from 'express';
import path from 'path';
import { Feeder, IFeeder } from '../models/feeder.model';
import { FeederReading, IFeederReading } from '../models/feederReading.model';
import { Region } from '../models/region.model';
import { formatDate } from '../utils/formatDate';
import { BusinessHub } from '../models/businessHub.model';
import { sendEmailWithAttachment } from '../utils/sendEmailWithAttachment';
import cron from 'node-cron';
import { addAnalysisSheetsToWorkbook } from '../utils/addAnalysisSheetsToWorkbook';

const TEMPLATE_PATH = path.join(__dirname, '../assets/Feeder_Performance_Template.xlsx');

// Interfaces
interface IReportDateRange {
  startDate: Date;
  endDate: Date;
}

interface IReportParams {
  region?: string;
  businessHub?: string;
  dateRange: IReportDateRange;
}

interface FailedChecks {
  feederName: string;
  businessHub: string;
  region: string;
  date: string;
  failedChecks: string[];
}

interface PopulatedFeeder extends Omit<IFeeder, 'businessHub' | 'region'> {
  businessHub: { name: string } | string;
  region: { name: string } | string;
}

// Utility functions
const getColumnLetter = (colIndex: number): string => {
  let letter = '';
  let current = colIndex;
  
  while (current > 0) {
    const temp = (current - 1) % 26;
    letter = String.fromCharCode(temp + 65) + letter;
    current = Math.floor((current - temp - 1) / 26);
  }
  
  return letter;
};

const getDatesInRange = (startDate: Date, endDate: Date): Date[] => {
  const dates: Date[] = [];
  const currentDate = new Date(startDate);
  currentDate.setUTCHours(0, 0, 0, 0);
  
  while (currentDate <= endDate) {
    dates.push(new Date(currentDate));
    currentDate.setUTCDate(currentDate.getUTCDate() + 1);
  }
  
  return dates;
};

const createBorderStyle = () => ({
  top: { style: 'thin' as const },
  left: { style: 'thin' as const },
  bottom: { style: 'thin' as const },
  right: { style: 'thin' as const }
});

function calculateDateRange(specificDate?: string): { startDate: Date, endDate: Date } {
  if (specificDate) {
    const date = new Date(specificDate);
    date.setUTCHours(0, 0, 0, 0);
    const endDate = new Date(date);
    endDate.setUTCHours(23, 59, 59, 999);
    return { startDate: date, endDate };
  }
  // Default: today
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const endDate = new Date(today);
  endDate.setUTCHours(23, 59, 59, 999);
  return { startDate: today, endDate };
}

function populateFailedChecksSummary(workbook: Workbook, failedChecksSummary: FailedChecks[]) {
  const summarySheet = workbook.getWorksheet('Failed Checks Summary');
  if (!summarySheet) return;
  let summaryRow = 6; // Assuming row 5 is header
  for (const check of failedChecksSummary) {
    summarySheet.getCell(`A${summaryRow}`).value = check.region;
    summarySheet.getCell(`B${summaryRow}`).value = check.businessHub;
    summarySheet.getCell(`C${summaryRow}`).value = check.feederName;
    summarySheet.getCell(`D${summaryRow}`).value = check.date;
    summarySheet.getCell(`E${summaryRow}`).value = check.failedChecks.join(', ');
    summaryRow++;
  }
}

// Data fetching service
class FeederDataService {
  private static readingsCache = new Map<string, IFeederReading[]>();
  private static cacheTimestamp = 0;
  private static readonly CACHE_TTL = 5 * 60 * 1000; // 5 minutes

  static async getFeedersWithPopulatedData(filter: any = {}): Promise<PopulatedFeeder[]> {
    const feeders = await Feeder.find(filter)
      .populate('businessHub', 'name')
      .populate('region', 'name')
      .sort({ region: 1, businessHub: 1, name: 1 })
      .lean();

    // Transform businessHub and region to match PopulatedFeeder type
    return feeders.map((feeder: any) => ({
      ...feeder,
      businessHub: feeder.businessHub && typeof feeder.businessHub === 'object' && 'name' in feeder.businessHub
        ? { name: feeder.businessHub.name }
        : typeof feeder.businessHub === 'string'
          ? feeder.businessHub
          : 'Unknown',
      region: feeder.region && typeof feeder.region === 'object' && 'name' in feeder.region
        ? { name: feeder.region.name }
        : typeof feeder.region === 'string'
          ? feeder.region
          : 'Unknown'
    })) as PopulatedFeeder[];
  }

  static async getAllReadingsInRange(startDate: Date, endDate: Date): Promise<IFeederReading[]> {
    const cacheKey = `${startDate.toISOString()}-${endDate.toISOString()}`;
    const now = Date.now();
    
    // Check cache validity
    if (this.readingsCache.has(cacheKey) && (now - this.cacheTimestamp) < this.CACHE_TTL) {
      return this.readingsCache.get(cacheKey)!;
    }

    const readings = await FeederReading.find({
      date: { $gte: startDate, $lte: endDate }
    })
    .sort({ date: 1, feeder: 1 })
    .lean() as IFeederReading[];

    // Update cache
    this.readingsCache.clear();
    this.readingsCache.set(cacheKey, readings);
    this.cacheTimestamp = now;

    return readings;
  }

  static groupReadingsByFeeder(readings: IFeederReading[]): Map<string, IFeederReading[]> {
    const readingsByFeeder = new Map<string, IFeederReading[]>();
    for (const reading of readings) {
      const feederId = String(reading.feeder);
      if (!readingsByFeeder.has(feederId)) {
        readingsByFeeder.set(feederId, []);
      }
      readingsByFeeder.get(feederId)!.push(reading);
    }
    return readingsByFeeder;
  }

  static async getRegionsAndHubs(): Promise<{ regions: any[], hubs: any[] }> {
    const [regions, hubs] = await Promise.all([
      Region.find().lean(),
      BusinessHub.find().lean()
    ]);
    
    return { regions, hubs };
  }
}

// Excel service for worksheet operations
class ExcelService {
  static async loadTemplate(): Promise<Workbook> {
    const workbook = new Workbook();
    await workbook.xlsx.readFile(TEMPLATE_PATH);
    return workbook;
  }

  static setupDateHeaders(worksheet: Worksheet, dates: Date[]): void {
    let columnIndex = 9; // Column I
    const border = createBorderStyle();
    
    for (const date of dates) {
      const formattedDate = formatDate(date);
      
      // Merge date header cells
      worksheet.mergeCells(`${getColumnLetter(columnIndex)}3:${getColumnLetter(columnIndex + 2)}3`);
      const headerCell = worksheet.getCell(`${getColumnLetter(columnIndex)}3`);
      headerCell.value = formattedDate;
      headerCell.alignment = { horizontal: 'center', vertical: 'middle' };
      headerCell.font = { bold: true };
      headerCell.border = border;

      // Set sub-headers
      ['Nomination', 'Actual', 'Variance'].forEach((label, i) => {
        const col = columnIndex + i;
        const cell = worksheet.getCell(`${getColumnLetter(col)}4`);
        cell.value = label;
        cell.font = { bold: true };
        cell.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'FFF2F2F2' }
        };
        cell.border = border;
        cell.alignment = { horizontal: 'center' };
        worksheet.getColumn(col).width = 15;
      });

      columnIndex += 4;
    }

    // Set fixed column widths
    const columnWidths = [10, 20, 35, 15, 15, 15, 15];
    columnWidths.forEach((width, i) => {
      worksheet.getColumn(i + 1).width = width;
    });
  }

  static createAnalysisSheets(workbook: Workbook, sourceWorksheet: Worksheet): void {
    const analysisCategories = [
      'Actual D-0 < Actual D-1',
      '< 70% Nom',
      '> 130% Nom',
      '< 70% Daily Uptake',
      '> 130% Daily Uptake',
      'Positive Variance',
      'No Flags',
      'Failed Checks Summary'
    ];

    for (const category of analysisCategories) {
      const analysisSheet = workbook.addWorksheet(category);
      this.copyHeadersToSheet(sourceWorksheet, analysisSheet);
    }
  }

  private static copyHeadersToSheet(sourceSheet: Worksheet, targetSheet: Worksheet): void {
    // Copy headers (rows 1-4)
    for (let row = 1; row <= 4; row++) {
      for (let col = 1; col <= sourceSheet.columnCount; col++) {
        const sourceCell = sourceSheet.getCell(row, col);
        const targetCell = targetSheet.getCell(row, col);
        targetCell.value = sourceCell.value;
        targetCell.style = JSON.parse(JSON.stringify(sourceCell.style));
      }
    }

    // Copy column widths
    for (let col = 1; col <= sourceSheet.columnCount; col++) {
      if (sourceSheet.getColumn(col).width) {
        targetSheet.getColumn(col).width = sourceSheet.getColumn(col).width;
      }
    }
  }

  static copyRowToAnalysisSheet(
    workbook: Workbook, 
    sourceWorksheet: Worksheet, 
    rowIndex: number, 
    targetSheetName: string
  ): void {
    const targetSheet = workbook.getWorksheet(targetSheetName);
    if (!targetSheet) return;

    const maxCol = targetSheetName === 'Failed Checks Summary' ? 5 : sourceWorksheet.columnCount;
    const targetRowIndex = targetSheet.rowCount + 1;

    for (let col = 1; col <= maxCol; col++) {
      const sourceCell = sourceWorksheet.getCell(rowIndex, col);
      const targetCell = targetSheet.getCell(targetRowIndex, col);
      targetCell.value = sourceCell.value;
      targetCell.style = JSON.parse(JSON.stringify(sourceCell.style));
    }
  }
}

// Report generation service
class ReportGenerationService {
  static async populateFeederData(
    worksheet: Worksheet,
    feeders: PopulatedFeeder[],
    dates: Date[],
    readingsByFeeder: Map<string, IFeederReading[]>,
    includeCompliance: boolean = false
  ): Promise<FailedChecks[]> {
    const border = createBorderStyle();
    const failedChecksSummary: FailedChecks[] = [];
    let rowIndex = 5;
    let feederSerial = 1;

    // Group feeders by region for better organization
    const feedersByRegion = new Map<string, PopulatedFeeder[]>();
    for (const feeder of feeders) {
      const regionName = typeof feeder.region === 'object' && feeder.region !== null && 'name' in feeder.region
        ? feeder.region.name
        : typeof feeder.region === 'string'
          ? feeder.region
          : 'Unknown';
      if (!feedersByRegion.has(regionName)) {
        feedersByRegion.set(regionName, []);
      }
      feedersByRegion.get(regionName)!.push(feeder);
    }

    for (const [regionName, regionFeeders] of feedersByRegion) {
      // Add region header
      worksheet.getCell(`A${rowIndex}`).value = regionName;
      worksheet.mergeCells(`A${rowIndex}:G${rowIndex}`);
      const regionCell = worksheet.getCell(`A${rowIndex}`);
      regionCell.font = { bold: true, size: 14 };
      regionCell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFD3D3D3' }
      };
      regionCell.alignment = { horizontal: 'center', vertical: 'middle' };
      regionCell.border = border;

      // Add borders to date columns for region header
      this.addDateColumnBorders(worksheet, rowIndex, dates.length);
      rowIndex++;

      // Process feeders in this region
      for (const feeder of regionFeeders) {
        const readings = readingsByFeeder.get(String(feeder._id)) || [];
        const readingMap = new Map<string, IFeederReading>();
        
        // Create reading lookup map
        for (const reading of readings) {
          const dateKey = formatDate(reading.date);
          readingMap.set(dateKey, reading);
        }

        // Populate static feeder data
        this.populateStaticFeederData(worksheet, feeder, rowIndex, feederSerial++, border);

        // Populate date-specific data
        let prevActual = 0;
        this.populateDateSpecificData(
          worksheet, 
          feeder, 
          dates, 
          readingMap, 
          rowIndex, 
          prevActual
        );

        // Run compliance checks if requested
        if (includeCompliance) {
          const feederFailedChecks = this.runComplianceChecks(
            feeder,
            readingMap,
            dates,
            prevActual
          );
          
          if (feederFailedChecks.length > 0) {
            failedChecksSummary.push({
              feederName: feeder.name,
              businessHub: typeof feeder.businessHub === 'object' && feeder.businessHub !== null && 'name' in feeder.businessHub
                ? feeder.businessHub.name
                : typeof feeder.businessHub === 'string'
                  ? feeder.businessHub
                  : 'Unknown',
              region: regionName,
              date: formatDate(dates[dates.length - 1]),
              failedChecks: feederFailedChecks
            });
          }
        }

        rowIndex++;
      }
    }

    return failedChecksSummary;
  }

  private static addDateColumnBorders(worksheet: Worksheet, rowIndex: number, dateCount: number): void {
    const border = createBorderStyle();
    let dateColIndex = 9;
    
    for (let i = 0; i < dateCount; i++) {
      for (let j = 0; j < 3; j++) {
        const col = dateColIndex + j;
        const cell = worksheet.getCell(`${getColumnLetter(col)}${rowIndex}`);
        cell.border = border;
      }
      dateColIndex += 4;
    }
  }

  private static populateStaticFeederData(
    worksheet: Worksheet,
    feeder: PopulatedFeeder,
    rowIndex: number,
    serial: number,
    border: any
  ): void {
    const staticData = [
      serial,
      typeof feeder.businessHub === 'object' && feeder.businessHub !== null && 'name' in feeder.businessHub
        ? feeder.businessHub.name
        : typeof feeder.businessHub === 'string'
          ? feeder.businessHub
          : 'Unknown',
      feeder.name,
      typeof feeder.region === 'object' && feeder.region !== null && 'name' in feeder.region
        ? feeder.region.name
        : typeof feeder.region === 'string'
          ? feeder.region
          : 'Unknown',
      feeder.band,
      feeder.dailyEnergyUptake,
      feeder.monthlyDeliveryPlan
    ];

    for (let col = 1; col <= 7; col++) {
      const cell = worksheet.getCell(rowIndex, col);
      cell.value = staticData[col - 1];
      cell.border = border;
    }
  }

  private static populateDateSpecificData(
    worksheet: Worksheet,
    feeder: PopulatedFeeder,
    dates: Date[],
    readingMap: Map<string, IFeederReading>,
    rowIndex: number,
    prevActual: number
  ): void {
    const border = createBorderStyle();
    let dateColIndex = 9;
    let currentPrevActual = prevActual;

    for (let i = 0; i < dates.length; i++) {
      const dateStr = formatDate(dates[i]);
      const reading = readingMap.get(dateStr);
      const nomination = feeder.dailyEnergyUptake * (i + 1);
      const actual = reading ? reading.cumulativeEnergyConsumption : currentPrevActual;
      const variance = actual - nomination;

      // Populate cells with data and styling
      const cells = [
        { col: dateColIndex, value: nomination },
        { col: dateColIndex + 1, value: actual },
        { col: dateColIndex + 2, value: variance }
      ];

      for (const { col, value } of cells) {
        const cell = worksheet.getCell(`${getColumnLetter(col)}${rowIndex}`);
        cell.value = value;
        cell.border = border;
        cell.alignment = { horizontal: 'center', vertical: 'middle' };
      }

      // Apply variance color coding
      const varianceCell = worksheet.getCell(`${getColumnLetter(dateColIndex + 2)}${rowIndex}`);
      varianceCell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { 
          argb: variance > 0 ? 'FFFF0000' : variance < 0 ? 'FF00FF00' : 'FFFFFFFF' 
        }
      };

      currentPrevActual = actual;
      dateColIndex += 4;
    }
  }

  private static runComplianceChecks(
    feeder: PopulatedFeeder,
    readingMap: Map<string, IFeederReading>,
    dates: Date[],
    prevActual: number
  ): string[] {
    const failedChecks: string[] = [];
    const lastDate = dates[dates.length - 1];
    const lastDateStr = formatDate(lastDate);
    const lastReading = readingMap.get(lastDateStr);

    if (!lastReading || lastReading.cumulativeEnergyConsumption <= 0) {
      return failedChecks;
    }

    const dayIndex = dates.length;
    const nomination = feeder.dailyEnergyUptake * dayIndex;
    const actual = lastReading.cumulativeEnergyConsumption;
    const variance = actual - nomination;

    // Get previous day actual
    let previousDayActual = prevActual;
    if (dayIndex > 1) {
      const prevDate = new Date(lastDate);
      prevDate.setUTCDate(prevDate.getUTCDate() - 1);
      const prevReading = readingMap.get(formatDate(prevDate));
      previousDayActual = prevReading ? prevReading.cumulativeEnergyConsumption : 0;
    }

    // Run compliance checks
    if (dayIndex > 1 && actual <= previousDayActual) {
      failedChecks.push('Actual D-0 < Actual D-1');
    }

    if (actual < 0.7 * nomination) {
      failedChecks.push('< 70% Nom');
    } else if (actual > 1.3 * nomination) {
      failedChecks.push('> 130% Nom');
    }

    if (dayIndex > 1) {
      const dailyActual = actual - previousDayActual;
      const dailyUptake = feeder.dailyEnergyUptake;
      
      if (dailyActual < 0.7 * dailyUptake) {
        failedChecks.push('< 70% Daily Uptake');
      } else if (dailyActual > 1.3 * dailyUptake) {
        failedChecks.push('> 130% Daily Uptake');
      }
    }

    return failedChecks;
  }
}

// Main report generation functions
export const generateDailyAllFeedersReportBuffer = async (req: Request, res: Response): Promise<Buffer> => {
  try {
    const { specificDate } = req.query;
    const { startDate, endDate } = calculateDateRange(specificDate as string);

    // Fetch all required data in parallel
    const [feeders, allReadings] = await Promise.all([
      FeederDataService.getFeedersWithPopulatedData(),
      FeederDataService.getAllReadingsInRange(startDate, endDate)
    ]);

    if (feeders.length === 0) {
      res.status(404).json({ message: "No feeders found in the system" });
      return Buffer.alloc(0);
    }

    // Setup workbook and worksheet
    const workbook = await ExcelService.loadTemplate();
    const worksheet = workbook.getWorksheet('Feeder Performance');
    if (!worksheet) throw new Error('Template worksheet not found');

    // Configure worksheet
    const dates = getDatesInRange(startDate, endDate);
    const startDateStr = formatDate(startDate);
    const endDateStr = formatDate(endDate);
    
    worksheet.getCell('F1').value = `FEEDER PERFORMANCE TRACKER (${startDateStr} TO ${endDateStr})`;
    
    ExcelService.setupDateHeaders(worksheet, dates);
    ExcelService.createAnalysisSheets(workbook, worksheet);

    // Group readings and populate data
    const readingsByFeeder = FeederDataService.groupReadingsByFeeder(allReadings);
    const failedChecksSummary = await ReportGenerationService.populateFeederData(
      worksheet,
      feeders,
      dates,
      readingsByFeeder,
      true // Include compliance checks
    );

    // Populate failed checks summary
    populateFailedChecksSummary(workbook, failedChecksSummary);

    // Generate and return buffer
    const buffer = await workbook.xlsx.writeBuffer();
    return buffer as Buffer;

  } catch (error: any) {
    console.error('Error generating report:', error);
    res.status(500).json({ 
      message: 'An error occurred while generating the report', 
      error: error.message 
    });
    return Buffer.alloc(0);
  }
};

/**
 * Generate a feeder performance report for a specific date (download as file)
 */
export const generateSpecificDateReport = async (req: Request, res: Response): Promise<void> => {
  try {
    const { date, region, businessHub } = req.query;
    if (!date) {
      res.status(400).json({ message: "Date is required" });
      return;
    }
    const reportDate = new Date(date as string);
    if (isNaN(reportDate.getTime())) {
      res.status(400).json({ message: "Invalid date format" });
      return;
    }
    const startDate = new Date(reportDate);
    startDate.setUTCHours(0, 0, 0, 0);
    const endDate = new Date(reportDate);
    endDate.setUTCHours(23, 59, 59, 999);

    // Fetch feeders with optional region/businessHub filter
    let feederFilter: any = {};
    if (region) {
      const regionDoc = await Region.findOne({ name: { $regex: new RegExp(`^${region}$`, 'i') } });
      if (!regionDoc) {
        res.status(404).json({ message: `Region '${region}' not found` });
        return;
      }
      feederFilter.region = regionDoc._id;
    }
    if (businessHub) {
      const hubDoc = await BusinessHub.findOne({ name: { $regex: new RegExp(`^${businessHub}$`, 'i') } });
      if (!hubDoc) {
        res.status(404).json({ message: `Business Hub '${businessHub}' not found` });
        return;
      }
      feederFilter.businessHub = hubDoc._id;
    }
    const feeders = await FeederDataService.getFeedersWithPopulatedData(feederFilter);
    if (feeders.length === 0) {
      res.status(404).json({ message: "No feeders found with the specified criteria" });
      return;
    }

    // Get readings for the day
    const allReadings = await FeederDataService.getAllReadingsInRange(startDate, endDate);
    const readingsByFeeder = FeederDataService.groupReadingsByFeeder(allReadings);

    // Setup workbook
    const workbook = await ExcelService.loadTemplate();
    const worksheet = workbook.getWorksheet('Feeder Performance');
    if (!worksheet) throw new Error('Template worksheet not found');
    const formattedDate = formatDate(reportDate);
    worksheet.getCell('F1').value = `FEEDER PERFORMANCE TRACKER - ${formattedDate}`;
    ExcelService.setupDateHeaders(worksheet, [reportDate]);
    ExcelService.createAnalysisSheets(workbook, worksheet);

    // Populate data
    await ReportGenerationService.populateFeederData(
      worksheet,
      feeders,
      [reportDate],
      readingsByFeeder,
      true
    );

    // Send file
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename=Energy_Monitoring_Report_${formattedDate}.xlsx`);
    res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition');
    await workbook.xlsx.write(res);
    res.end();
  } catch (error: any) {
    console.error('Error generating specific date report:', error);
    res.status(500).json({ message: error.message || "Failed to generate report for specific date" });
  }
};

/**
 * Generate a report for specific feeders (by IDs)
 */
export const generateFeederSpecificReport = async (req: Request, res: Response): Promise<void> => {
  try {
    const { feederIds, startDate, endDate } = req.body;
    if (!feederIds || !Array.isArray(feederIds) || feederIds.length === 0) {
      res.status(400).json({ message: "Feeder IDs are required" });
      return;
    }
    if (!startDate || !endDate) {
      res.status(400).json({ message: "Start and end dates are required" });
      return;
    }
    const feeders = await FeederDataService.getFeedersWithPopulatedData({ _id: { $in: feederIds } });
    if (feeders.length === 0) {
      res.status(404).json({ message: "No feeders found with the specified IDs" });
      return;
    }
    const start = new Date(startDate);
    const end = new Date(endDate);
    const allReadings = await FeederDataService.getAllReadingsInRange(start, end);
    const readingsByFeeder = FeederDataService.groupReadingsByFeeder(allReadings);
    const workbook = await ExcelService.loadTemplate();
    const worksheet = workbook.getWorksheet('Feeder Performance');
    if (!worksheet) throw new Error('Template worksheet not found');
    ExcelService.setupDateHeaders(worksheet, getDatesInRange(start, end));
    ExcelService.createAnalysisSheets(workbook, worksheet);
    await ReportGenerationService.populateFeederData(
      worksheet,
      feeders,
      getDatesInRange(start, end),
      readingsByFeeder,
      true
    );
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename=FeederReport-${new Date().toISOString().split('T')[0]}.xlsx`);
    await workbook.xlsx.write(res);
    res.end();
  } catch (error: any) {
    console.error('Error generating feeder specific report:', error);
    res.status(500).json({ message: "Failed to generate feeder specific report" });
  }
};

/**
 * Send report by email for a date range or specific date
 */
export const sendReportByEmail = async (req: Request, res: Response): Promise<void> => {
  try {
    const {
      startDate,
      endDate,
      date,
      region,
      businessHub,
      email,
      reportType,
      includeAnalysis
    } = req.body;

    if (!email) {
      res.status(400).json({ message: "Recipient email is required" });
      return;
    }

    let start = startDate;
    let end = endDate;
    if (!start || !end) {
      if (date) {
        start = date;
        end = date;
      } else {
        res.status(400).json({ message: "startDate/endDate or date is required" });
        return;
      }
    }

    // Build feeder filter
    let feederFilter: any = {};
    if (region) {
      const regionDoc = await Region.findOne({ name: { $regex: new RegExp(`^${region}$`, 'i') } });
      if (regionDoc) feederFilter.region = regionDoc._id;
    }
    if (businessHub) {
      const hubDoc = await BusinessHub.findOne({ name: { $regex: new RegExp(`^${businessHub}$`, 'i') } });
      if (hubDoc) feederFilter.businessHub = hubDoc._id;
    }
    const feeders = await FeederDataService.getFeedersWithPopulatedData(feederFilter);
    if (feeders.length === 0) {
      res.status(404).json({ message: "No feeders found with the specified criteria" });
      return;
    }
    const startD = new Date(start);
    const endD = new Date(end);
    const allReadings = await FeederDataService.getAllReadingsInRange(startD, endD);
    const readingsByFeeder = FeederDataService.groupReadingsByFeeder(allReadings);
    const workbook = await ExcelService.loadTemplate();
    const worksheet = workbook.getWorksheet('Feeder Performance');
    if (!worksheet) throw new Error('Template worksheet not found');
    ExcelService.setupDateHeaders(worksheet, getDatesInRange(startD, endD));
    ExcelService.createAnalysisSheets(workbook, worksheet);
    await ReportGenerationService.populateFeederData(
      worksheet,
      feeders,
      getDatesInRange(startD, endD),
      readingsByFeeder,
      includeAnalysis === true || includeAnalysis === "true"
    );
    const buffer = await workbook.xlsx.writeBuffer();
    await sendEmailWithAttachment({
      to: email,
      subject: `Energy Monitoring Report (${start}${start !== end ? ` to ${end}` : ""})`,
      text: `Please find attached the ${reportType || "energy"} report for ${start}${start !== end ? ` to ${end}` : ""}.`,
      attachmentBuffer: buffer as Buffer,
      filename: `Energy_Report_${start}_to_${end}.xlsx`,
    });
    res.status(200).json({ message: "Report sent successfully!" });
  } catch (error: any) {
    console.error("Error sending report email:", error);
    res.status(500).json({ message: "Failed to send report email", error: error.message });
  }
};

/**
 * Generate a custom report (by type, region, hub, date range)
 */
export const generateCustomReport = async (req: Request, res: Response): Promise<void> => {
  try {
    const { reportType, startDate, endDate, region, businessHub, includeAnalysis } = req.query;
    if (!reportType || !startDate || !endDate) {
      res.status(400).json({ message: "reportType, startDate, and endDate are required" });
      return;
    }
    let feederFilter: any = {};
    if (region) {
      const regionDoc = await Region.findOne({ name: { $regex: new RegExp(`^${region}$`, 'i') } });
      if (regionDoc) feederFilter.region = regionDoc._id;
    }
    if (businessHub) {
      const hubDoc = await BusinessHub.findOne({ name: { $regex: new RegExp(`^${businessHub}$`, 'i') } });
      if (hubDoc) feederFilter.businessHub = hubDoc._id;
    }
    const feeders = await FeederDataService.getFeedersWithPopulatedData(feederFilter);
    if (feeders.length === 0) {
      res.status(404).json({ message: "No feeders found with the specified criteria" });
      return;
    }
    const start = new Date(startDate as string);
    const end = new Date(endDate as string);
    const allReadings = await FeederDataService.getAllReadingsInRange(start, end);
    const readingsByFeeder = FeederDataService.groupReadingsByFeeder(allReadings);
    const workbook = await ExcelService.loadTemplate();
    const worksheet = workbook.getWorksheet('Feeder Performance');
    if (!worksheet) throw new Error('Template worksheet not found');
    ExcelService.setupDateHeaders(worksheet, getDatesInRange(start, end));
    ExcelService.createAnalysisSheets(workbook, worksheet);
    await ReportGenerationService.populateFeederData(
      worksheet,
      feeders,
      getDatesInRange(start, end),
      readingsByFeeder,
      includeAnalysis === "true"
    );
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename=Custom_Report_${startDate}_to_${endDate}.xlsx`);
    await workbook.xlsx.write(res);
    res.end();
  } catch (error: any) {
    res.status(500).json({ message: error.message || "Failed to generate custom report" });
  }
};

/**
 * Send daily all feeders report
 */
export const sendDailyAllFeedersReport = async (req: Request, res: Response): Promise<void> => {
  try {
    const buffer: Buffer = await generateDailyAllFeedersReportBuffer(req, res);
    await sendEmailWithAttachment({
      to: "recipient@example.com", // Replace with actual recipient(s) or get from req.body
      subject: "Daily All Feeders Report",
      text: "Please find attached the daily feeders report.",
      attachmentBuffer: buffer,
      filename: "DailyAllFeedersReport.xlsx",
    });
    res.status(200).json({ message: "Daily report sent successfully." });
  } catch (error) {
    console.error("Error sending daily report:", error);
    res.status(500).json({ error: "Failed to send daily report." });
  }
};
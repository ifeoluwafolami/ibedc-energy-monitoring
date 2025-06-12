import { Workbook, Worksheet } from 'exceljs';
import { IFeeder } from '../models/feeder.model';
import { IFeederReading, FeederReading } from '../models/feederReading.model';
import { formatDate } from './formatDate';

/**
 * Helper: Copy a row to an analysis sheet.
 */
function copyRowToAnalysisSheet(
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

/**
 * Add analysis sheets to a workbook for the given feeders and dates.
 */
export async function addAnalysisSheetsToWorkbook(
  workbook: Workbook,
  feeders: IFeeder[],
  dates: Date[]
) {
  const worksheet = workbook.getWorksheet('Feeder Performance');
  if (!worksheet) throw new Error('Template worksheet not found');

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

  analysisCategories.forEach(category => {
    const analysisSheet = workbook.addWorksheet(category);
    for (let col = 1; col <= worksheet.columnCount; col++) {
      for (let row = 1; row <= 4; row++) {
        const sourceCell = worksheet.getCell(row, col);
        const targetCell = analysisSheet.getCell(row, col);
        targetCell.value = sourceCell.value;
        targetCell.style = JSON.parse(JSON.stringify(sourceCell.style));
        if (sourceCell.isMerged) {
          const mergedRanges = worksheet.model.merges;
          for (const rangeStr of mergedRanges) {
            const match = /^([A-Z]+)(\d+):([A-Z]+)(\d+)$/.exec(rangeStr);
            if (match) {
              const [, startCol, startRow, endCol, endRow] = match;
              const colToNum = (col: string) => {
                let num = 0;
                for (let i = 0; i < col.length; i++) {
                  num = num * 26 + (col.charCodeAt(i) - 64);
                }
                return num;
              };
              const top = parseInt(startRow, 10);
              const left = colToNum(startCol);
              const bottom = parseInt(endRow, 10);
              const right = colToNum(endCol);

              if (row >= top && row <= bottom && col >= left && col <= right) {
                if (row === top && col === left) {
                  analysisSheet.mergeCells(top, left, bottom, right);
                }
              }
            }
          }
        }
      }
    }
    for (let col = 1; col <= worksheet.columnCount; col++) {
      if (worksheet.getColumn(col).width) {
        analysisSheet.getColumn(col).width = worksheet.getColumn(col).width;
      }
    }
  });

  // Fetch all readings for all feeders in the date range, once
  const allReadings = await FeederReading.find({
    date: { $gte: dates[0], $lte: dates[dates.length - 1] }
  }).sort({ date: 1 }).lean();

  // Group readings by feeder._id as string
  const readingsByFeeder: { [feederId: string]: IFeederReading[] } = {};
  allReadings.forEach(reading => {
    const feederId = String(reading.feeder);
    if (!readingsByFeeder[feederId]) readingsByFeeder[feederId] = [];
    readingsByFeeder[feederId].push(reading);
  });

  // Group feeders by region
  const feedersByRegion: { [key: string]: IFeeder[] } = {};
  feeders.forEach(feeder => {
    const regionName = typeof feeder.region === 'object' ? (feeder.region as any).name : 'Unknown';
    if (!feedersByRegion[regionName]) {
      feedersByRegion[regionName] = [];
    }
    feedersByRegion[regionName].push(feeder);
  });

  let rowIndex = 5;
  let feederSerial = 1;
  const failedChecksSummary: {
    feederName: string;
    businessHub: string;
    region: string;
    date: string;
    failedChecks: string[];
  }[] = [];

  for (const regionName of Object.keys(feedersByRegion)) {
    rowIndex++; // skip region header row
    for (const feeder of feedersByRegion[regionName]) {
      const readings = readingsByFeeder[String(feeder._id)] || [];
      const businessHubName = typeof feeder.businessHub === 'object' && feeder.businessHub !== null
        ? (feeder.businessHub as any).name
        : 'Unknown';

      const readingMap = new Map<string, IFeederReading>();
      readings.forEach(reading => {
        const dateKey = formatDate(reading.date);
        readingMap.set(dateKey, reading);
      });

      // --- Compliance Checks: Only run on last day, but copy full row if failed ---
      const readingDates = readings.map(r => formatDate(r.date));
      const lastDateStr = readingDates.sort().slice(-1)[0];
      const lastReading = lastDateStr ? readingMap.get(lastDateStr) : undefined;

      let previousDayActual = 0;
      if (lastDateStr && lastReading) {
        const lastDateObj = new Date(lastReading.date);
        const prevDateObj = new Date(lastDateObj);
        prevDateObj.setUTCDate(lastDateObj.getUTCDate() - 1);
        const prevDateStr = formatDate(prevDateObj);
        const prevReading = readingMap.get(prevDateStr);
        previousDayActual = prevReading ? prevReading.cumulativeEnergyConsumption : 0;

        const dayIndex = dates.findIndex(d => formatDate(d) === lastDateStr) + 1;
        const nomination = feeder.dailyEnergyUptake * dayIndex;
        const actual = lastReading.cumulativeEnergyConsumption;
        const variance = actual - nomination;
        const dailyUptake = feeder.dailyEnergyUptake;

        const failedChecks: string[] = [];

        if (actual > 0) {
          if (dayIndex > 1 && actual <= previousDayActual) {
            failedChecks.push('Actual D-0 < Actual D-1');
            copyRowToAnalysisSheet(workbook, worksheet, rowIndex, 'Actual D-0 < Actual D-1');
          }
          if (actual < 0.7 * nomination) {
            failedChecks.push('< 70% Nom');
            copyRowToAnalysisSheet(workbook, worksheet, rowIndex, '< 70% Nom');
          } else if (actual > 1.3 * nomination) {
            failedChecks.push('> 130% Nom');
            copyRowToAnalysisSheet(workbook, worksheet, rowIndex, '> 130% Nom');
          }
          if (dayIndex > 1) {
            const dailyActual = actual - previousDayActual;
            if (dailyActual < 0.7 * dailyUptake) {
              failedChecks.push('< 70% Daily Uptake');
              copyRowToAnalysisSheet(workbook, worksheet, rowIndex, '< 70% Daily Uptake');
            } else if (dailyActual > 1.3 * dailyUptake) {
              failedChecks.push('> 130% Daily Uptake');
              copyRowToAnalysisSheet(workbook, worksheet, rowIndex, '> 130% Daily Uptake');
            }
          }
          if (variance >= 0) {
            copyRowToAnalysisSheet(workbook, worksheet, rowIndex, 'Positive Variance');
          }
          if (failedChecks.length === 0) {
            copyRowToAnalysisSheet(workbook, worksheet, rowIndex, 'No Flags');
          } else {
            failedChecksSummary.push({
              feederName: feeder.name,
              businessHub: businessHubName,
              region: regionName,
              date: lastDateStr,
              failedChecks: failedChecks
            });
          }
        }
      }
      rowIndex++;
    }
  }

  // Fill Failed Checks Summary sheet
  const summarySheet = workbook.getWorksheet('Failed Checks Summary');
  if (summarySheet) {
    let summaryRow = 5;
    summarySheet.getCell(`A${summaryRow}`).value = 'Region';
    summarySheet.getCell(`B${summaryRow}`).value = 'Business Hub';
    summarySheet.getCell(`C${summaryRow}`).value = 'Feeder Name';
    summarySheet.getCell(`D${summaryRow}`).value = 'Date';
    summarySheet.getCell(`E${summaryRow}`).value = 'Failed Checks';

    for (let col = 1; col <= 5; col++) {
      const cell = summarySheet.getCell(summaryRow, col);
      cell.font = { bold: true };
      cell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFF2F2F2' }
      };
      cell.border = {
        top: { style: 'thin' },
        left: { style: 'thin' },
        bottom: { style: 'thin' },
        right: { style: 'thin' }
      };
      cell.alignment = { horizontal: 'center' };
    }

    summaryRow++;

    for (const check of failedChecksSummary) {
      summarySheet.getCell(`A${summaryRow}`).value = check.region;
      summarySheet.getCell(`B${summaryRow}`).value = check.businessHub;
      summarySheet.getCell(`C${summaryRow}`).value = check.feederName;
      summarySheet.getCell(`D${summaryRow}`).value = check.date;
      summarySheet.getCell(`E${summaryRow}`).value = check.failedChecks.join(', ');

      for (let col = 1; col <= 5; col++) {
        const cell = summarySheet.getCell(summaryRow, col);
        cell.border = {
          top: { style: 'thin' },
          left: { style: 'thin' },
          bottom: { style: 'thin' },
          right: { style: 'thin' }
        };
      }
      summaryRow++;
    }

    summarySheet.getColumn(1).width = 15;
    summarySheet.getColumn(2).width = 20;
    summarySheet.getColumn(3).width = 35;
    summarySheet.getColumn(4).width = 15;
    summarySheet.getColumn(5).width = 40;
  }
}
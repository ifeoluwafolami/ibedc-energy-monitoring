import { Request, Response } from "express";
import { isBlank } from "../utils/isBlank";
import { FeederReading, IFeederReading } from "../models/feederReading.model";
import { Feeder } from "../models/feeder.model";
import mongoose from "mongoose";

interface AuthenticatedRequest extends Request {
    user?: any;
}

const DEFAULT_PAGE_SIZE = 10;

export const createFeederReading = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
        const { date, cumulativeEnergyConsumption } = req.body;
        const feeder = req.params.feederId;
        const recordedBy = req.user?._id;

        if (!req.user) {
            res.status(401).json({ message: "User not authenticated" });
            return;
        }

        if (isBlank(date) || isBlank(feeder) || cumulativeEnergyConsumption === undefined) {
            res.status(400).json({message: "Date, feeder and energy are required."});
            return;
        }

        const newReading = await FeederReading.create({
            date: new Date(date),
            feeder,
            cumulativeEnergyConsumption,
            recordedBy,
            history: []
        });

        res.status(201).json({message: "Feeder reading created successfully."});
    } catch (error) {
        console.error("Error creating feeder reading: ", error);
        res.status(500).json({message: "Failed to create feeder reading."});
    }
}

// Get all readings for all feeders (with pagination)
export const getAllFeederReadings = async (req: Request, res: Response): Promise<void> => {
    try {
        const page = parseInt(req.query.page as string) || 1;
        const limit = parseInt(req.query.limit as string) || DEFAULT_PAGE_SIZE;
        const skip = (page - 1) * limit;

        const total = await FeederReading.countDocuments();
        const readings = await FeederReading.find()
            .populate("feeder", "name businessHub region")
            .populate("recordedBy", "name email")
            .sort({ date: -1 })
            .skip(skip)
            .limit(limit);

        res.status(200).json({
            total,
            page,
            pages: Math.ceil(total / limit),
            data: readings
        });
    } catch (error) {
        console.error("Error fetching feeder readings: ", error);
        res.status(500).json({message: "Failed to fetch feeder readings."});
    }
}

// Get all readings for a particular feeder (with pagination)
export const getReadingsByFeeder = async (req: Request, res: Response): Promise<void> => {
    try {
        const { feederId } = req.params;
        const page = parseInt(req.query.page as string) || 1;
        const limit = parseInt(req.query.limit as string) || DEFAULT_PAGE_SIZE;
        const skip = (page - 1) * limit;

        const total = await FeederReading.countDocuments({ feeder: feederId });
        const readings = await FeederReading.find({ feeder: feederId })
            .sort({ date: -1 })
            .skip(skip)
            .limit(limit);

        res.status(200).json({
            total,
            page,
            pages: Math.ceil(total / limit),
            data: readings
        });
    } catch (error) {
        console.error("Error getting feeder readings: ", error);
        res.status(500).json({message: "Failed to get readings for feeder."});
    }
};

// Get a single reading by feeder ID and date
export const getFeederReadingsByDate = async (req: Request, res: Response): Promise<void> => {
    try {
        const { feederId } = req.params;
        const { date } = req.query;

        if (!date) {
            res.status(400).json({message: "Date is required."});
            return;
        }

        const reading = await FeederReading.findOne({
            feeder: feederId,
            date: new Date(date as string)
        });

        if (!reading) {
            res.status(404).json({ message: "No reading found for the given date." });
            return;
        }

        res.status(200).json(reading);
    } catch (error) {
        console.error("Error fetching feeder reading by date: ", error);
        res.status(500).json({message: "Failed to fetch feeder reading by date."});
    }
}

// Get readings for all feeders in a region or business hub for a date or date range (with pagination)
export const getReadingsByRegionOrHub = async (req: Request, res: Response): Promise<void> => {
    try {
        const { region, businessHub, startDate, endDate } = req.query;

        if (!region && !businessHub) {
            res.status(400).json({ message: "Provide either region or businessHub." });
            return;
        }

        const page = parseInt(req.query.page as string) || 1;
        const limit = parseInt(req.query.limit as string) || DEFAULT_PAGE_SIZE;
        const skip = (page - 1) * limit;

        const feederFilter: any = {};
        if (region) feederFilter.region = region;
        if (businessHub) feederFilter.businessHub = businessHub;

        const feeders = await Feeder.find(feederFilter).select("_id");
        const feederIds = feeders.map(f => f._id);

        const dateFilter: any = {};
        if (startDate && endDate) {
            dateFilter.date = {
                $gte: new Date(startDate as string),
                $lte: new Date(endDate as string),
            };
        } else if (startDate) {
            dateFilter.date = new Date(startDate as string);
        } else {
            res.status(400).json({ message: "Provide a date or date range." });
            return;
        }

        const total = await FeederReading.countDocuments({
            feeder: { $in: feederIds },
            ...dateFilter
        });

        const readings = await FeederReading.find({
            feeder: { $in: feederIds },
            ...dateFilter
        })
            .populate("feeder", "name region businessHub")
            .populate("recordedBy", "name email")
            .sort({ date: -1 })
            .skip(skip)
            .limit(limit);

        res.status(200).json({
            total,
            page,
            pages: Math.ceil(total / limit),
            data: readings
        });
    } catch (error) {
        console.error("Error fetching readings by region or hub:", error);
        res.status(500).json({ message: "Internal server error." });
    }
};

// Get a Feeder Reading
export const getFeederReading = async (req: Request, res: Response): Promise<void> => {
    try {
        const { id } = req.params;

        const reading = await FeederReading.findById(id).populate("feeder", "name").populate("recordedBy", "name email");
    
        if (!reading) {
            res.status(404).json({ message: "Feeder reading not found." });
            return;
        }

        res.status(200).json({message: "Feeder reading fetched successfully.", reading});
    } catch(error) {
        console.error("Error fetching feeder reading:", error);
        res.status(500).json({message: "Failed to fetch feeder reading."});
    }
}

// Update a feeder reading (add to history)
export const updateFeederReading = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
        const { id } = req.params;
        const { cumulativeEnergyConsumption } = req.body;
        const updatedBy = req.user?._id;

        if (!req.user) {
            res.status(401).json({ message: "User not authenticated" });
            return;
        }

        const reading = await FeederReading.findById(id);
        if (!reading) {
            res.status(404).json({ message: "Feeder reading not found." });
            return;
        }

        reading.history.push({
            date: reading.date,
            cumulativeEnergyConsumption: reading.cumulativeEnergyConsumption,
            updatedAt: new Date(),
            updatedBy
        });

        reading.cumulativeEnergyConsumption = cumulativeEnergyConsumption;
        await reading.save();

        res.status(200).json({ message: "Feeder reading updated successfully.", data: reading });
    } catch (error) {
        console.error("Error updating feeder reading:", error);
        res.status(500).json({ message: "Internal server error." });
    }
};

// Delete a feeder reading
export const deleteFeederReading = async (req: Request, res: Response): Promise<void> => {
    try {
        const { id } = req.params;

        const reading = await FeederReading.findById(id);
        if (!reading) {
            res.status(404).json({ message: "Feeder reading not found." });
            return;
        }

        await FeederReading.findByIdAndDelete(id);
        res.status(200).json({ message: "Feeder reading deleted successfully." });
    } catch (error) {
        console.error("Error deleting feeder reading:", error);
        res.status(500).json({ message: "Internal server error." });
    }
};

export const submitTodayReadings = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const user = req.user;
    
    if (!user) {
        res.status(401).json({ message: "User not authenticated" });
        return;
    }

    const readings = req.body.readings;

    if (!Array.isArray(readings) || readings.length === 0) {
      res.status(400).json({ message: "Readings are required." });
      return;
    }

    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
    const todayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);

    const entriesToInsert = [];
    const updatedReadings = [];

    for (const reading of readings) {
      const { feeder, cumulativeEnergyConsumption } = reading;

      if (!feeder || cumulativeEnergyConsumption === undefined) {
        res.status(400).json({
          message: "Each reading must include a feeder and cumulativeEnergyConsumption.",
        });
        return;
      }

      const existing = await FeederReading.findOne({
        feeder: new mongoose.Types.ObjectId(String(feeder)),
        date: { $gte: todayStart, $lte: todayEnd },
      });

      if (existing) {
        existing.history.push({
          date: existing.date,
          cumulativeEnergyConsumption: existing.cumulativeEnergyConsumption,
          updatedAt: new Date(),
          updatedBy: user._id,
        });

        existing.cumulativeEnergyConsumption = cumulativeEnergyConsumption;
        existing.date = new Date();
        await existing.save();
        updatedReadings.push(existing);
      } else {
        entriesToInsert.push({
          feeder: new mongoose.Types.ObjectId(String(feeder)),
          cumulativeEnergyConsumption,
          date: new Date(),
          recordedBy: user._id,
          history: [],
        });
      }
    }

    let savedReadings: IFeederReading[] = [];
    if (entriesToInsert.length > 0) {
      savedReadings = await FeederReading.insertMany(entriesToInsert);
    }

    res.status(200).json({
      message: "Readings submitted successfully.",
      created: savedReadings,
      updated: updatedReadings,
    });
  } catch (error) {
    console.error("Error submitting readings:", error);
    res.status(500).json({ message: "Server error while submitting readings." });
  }
};
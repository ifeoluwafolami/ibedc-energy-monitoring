import { Request, Response } from "express";
import { isBlank } from "../utils/isBlank";
import { Feeder } from "../models/feeder.model";
import { Region } from "../models/region.model";
import { BusinessHub } from "../models/businessHub.model";

const VALID_BANDS = ['A20H', 'B16H', 'C12H', 'D8H', 'E4H'];

// Create new feeder
export const createFeeder = async (req: Request, res: Response): Promise<void> => {
    try {
        const { name, businessHub, band, dailyEnergyUptake, monthlyDeliveryPlan, previousMonthConsumption } = req.body;

        if (isBlank(name) || isBlank(businessHub) || isBlank(band)) {
            res.status(400).json({message: "Name, business hub, and band are required."});
            return;
        }

        if (!VALID_BANDS.includes(band)) {
            res.status(400).json({message: `Band must be one of: ${VALID_BANDS.join(', ')}`});
            return;
        }

        if ((dailyEnergyUptake !== undefined && dailyEnergyUptake < 0) || 
            (monthlyDeliveryPlan !== undefined && monthlyDeliveryPlan < 0) || 
            (previousMonthConsumption !== undefined && previousMonthConsumption < 0)) {
            res.status(400).json({message: "Energy values cannot be negative."});
            return;
        }

        const bHub = await BusinessHub.findById(businessHub);
        if (!bHub) {
            res.status(404).json({ message: "Business Hub not found." });
            return;
        }

        const trimmedName = name.trim();

        const feederExists = await Feeder.findOne({ 
            name: trimmedName, 
            businessHub: businessHub 
        });
        if (feederExists) {
            res.status(400).json({message: "Feeder already exists in this Business Hub."});
            return;
        }

        const feeder = await Feeder.create({
            name: trimmedName,
            businessHub,
            region: bHub.region._id,
            band,
            dailyEnergyUptake,
            monthlyDeliveryPlan,
            previousMonthConsumption
        });

        await feeder.populate([
            { path: 'businessHub', select: 'name' },
            { path: 'region', select: 'name' }
        ]);

        res.status(201).json({message: "Feeder created successfully.", feeder});

    } catch (error) {
        console.error("Error creating feeder: ", error);
        res.status(500).json({message: "Failed to create feeder."});
    }
}

// Fetch all Feeders
export const getAllFeeders = async (req: Request, res: Response): Promise<void> => {
    try {
        const feeders = await Feeder.find()
            .populate('businessHub', 'name')
            .populate('region', 'name')
            .sort({ name: 1 });
        
        res.status(200).json(feeders);
    } catch (error) {
        console.error("Error fetching feeders: ", error);
        res.status(500).json({message: "Failed to fetch feeders."});
    }
}

// Fetch a Feeder
export const getFeeder = async (req: Request, res: Response): Promise<void> => {
    try {
        const { id } = req.params;

        const feeder = await Feeder.findById(id)
            .populate('businessHub', 'name')
            .populate('region', 'name');

        if (!feeder) {
            res.status(404).json({message: "Feeder not found."});
            return;
        }

        res.status(200).json(feeder);
    } catch (error) {
        console.error("Error fetching feeder: ", error);
        res.status(500).json({message: "Failed to fetch feeder."});
    }
}

// Update Feeder
export const updateFeeder = async (req: Request, res: Response): Promise<void> => {
    try {
        const { name, businessHub, band, dailyEnergyUptake, monthlyDeliveryPlan, previousMonthConsumption } = req.body;
        const { id } = req.params;

        if (!name && !businessHub && !band && 
            dailyEnergyUptake === undefined && 
            monthlyDeliveryPlan === undefined && 
            previousMonthConsumption === undefined) {
            res.status(400).json({ message: "No update fields provided." });
            return;
        }

        const updateData: any = {};

        if (name) {
            const trimmedName = name.trim();
            if (isBlank(trimmedName)) {
                res.status(400).json({ message: "Feeder name cannot be blank." });
                return;
            }
            updateData.name = trimmedName;
        }

        if (band) {
            if (!VALID_BANDS.includes(band)) {
                res.status(400).json({message: `Band must be one of: ${VALID_BANDS.join(', ')}`});
                return;
            }
            updateData.band = band;
        }

        if (businessHub) {
            const bHub = await BusinessHub.findById(businessHub);
            if (!bHub) {
                res.status(400).json({ message: "Specified business hub does not exist." });
                return;
            }
            updateData.businessHub = businessHub;
            updateData.region = bHub.region._id;
        }

        if (dailyEnergyUptake !== undefined) {
            if (dailyEnergyUptake < 0) {
                res.status(400).json({message: "Daily energy uptake cannot be negative."});
                return;
            }
            updateData.dailyEnergyUptake = dailyEnergyUptake;
        }

        if (monthlyDeliveryPlan !== undefined) {
            if (monthlyDeliveryPlan < 0) {
                res.status(400).json({message: "Monthly delivery plan cannot be negative."});
                return;
            }
            updateData.monthlyDeliveryPlan = monthlyDeliveryPlan;
        }

        if (previousMonthConsumption !== undefined) {
            if (previousMonthConsumption < 0) {
                res.status(400).json({message: "Previous month consumption cannot be negative."});
                return;
            }
            updateData.previousMonthConsumption = previousMonthConsumption;
        }

        if (updateData.name || updateData.businessHub) {
            let currentFeeder = null;
            if (!updateData.name || !updateData.businessHub) {
                currentFeeder = await Feeder.findById(id);
                if (!currentFeeder) {
                    res.status(404).json({ message: "Feeder not found." });
                    return;
                }
            }

            const nameToCheck = updateData.name || currentFeeder?.name;
            const businessHubToCheck = updateData.businessHub || currentFeeder?.businessHub;

            const existingFeeder = await Feeder.findOne({
                name: nameToCheck,
                businessHub: businessHubToCheck,
                _id: { $ne: id }
            });

            if (existingFeeder) {
                res.status(400).json({message: "Feeder with this name already exists in the specified Business Hub."});
                return;
            }
        }
        
        const updatedFeeder = await Feeder.findByIdAndUpdate(
            id, 
            updateData, 
            { new: true, runValidators: true }
        )
        .populate('businessHub', 'name')
        .populate('region', 'name');

        if (!updatedFeeder) {
            res.status(404).json({ message: "Feeder not found." });
            return;
        }

        res.status(200).json({ message: "Feeder updated successfully.", feeder: updatedFeeder });

    } catch (error) {
        console.error("Error updating feeder: ", error);
        res.status(500).json({ message: "Failed to update feeder." });
    }
};

// Delete feeder
export const deleteFeeder = async(req: Request, res: Response): Promise<void> => {
    try {
        const { id } = req.params;

        const feeder = await Feeder.findByIdAndDelete(id);
        if (!feeder) {
            res.status(404).json({message: "Feeder not found."});
            return;
        }

        res.status(200).json({message: "Feeder deleted successfully."});

    } catch (error) {
        console.error("Error deleting feeder: ", error);
        res.status(500).json({message: "Failed to delete feeder."});
    }
}

// Filter Feeders By Region ID
export const filterFeedersByRegion = async (req: Request, res: Response): Promise<void> => {
    try {
        const regionId = req.query.regionId as string;
        
        if (!regionId || isBlank(regionId)) {
            res.status(400).json({message: "Region ID is required."});
            return;
        }

        const region = await Region.findById(regionId);
        if (!region) {
            res.status(404).json({message: "Region not found."});
            return;
        }

        const feedersInRegion = await Feeder.find({ region: regionId })
            .populate('region', 'name')
            .populate('businessHub', 'name')
            .sort({ name: 1 });

        res.status(200).json(feedersInRegion);

    } catch (error) {
        console.error("Error filtering feeders by region: ", error);
        res.status(500).json({message: "Error filtering feeders by region."});
    }
}

// Filter Feeders By Business Hub ID
export const filterFeedersByBusinessHub = async (req: Request, res: Response): Promise<void> => {
    try {
        const businessHubId = req.query.businessHubId as string;
        
        if (!businessHubId || isBlank(businessHubId)) {
            res.status(400).json({message: "Business Hub ID is required."});
            return;
        }

        const businessHub = await BusinessHub.findById(businessHubId);
        if (!businessHub) {
            res.status(404).json({message: "Business Hub not found."});
            return;
        }

        const feedersInBusinessHub = await Feeder.find({ businessHub: businessHubId })
            .populate('businessHub', 'name')
            .populate('region', 'name')
            .sort({ name: 1 });

        res.status(200).json(feedersInBusinessHub);

    } catch (error) {
        console.error("Error filtering feeders by business hub: ", error);
        res.status(500).json({message: "Error filtering feeders by business hub."});
    }
}

// Filter Feeders by Band
export const filterFeedersByBand = async (req: Request, res: Response): Promise<void> => {
    try {
        const band = req.query.band as string;
        
        if (isBlank(band)) {
            res.status(400).json({message: "Band is required."});
            return;
        }

        const trimmedBand = band.trim().toUpperCase();
        
        if (!VALID_BANDS.includes(trimmedBand)) {
            res.status(400).json({message: `Band must be one of: ${VALID_BANDS.join(', ')}`});
            return;
        }

        const feedersInBand = await Feeder.find({ band: trimmedBand })
            .populate('businessHub', 'name')
            .populate('region', 'name')
            .sort({ name: 1 });

        res.status(200).json(feedersInBand);

    } catch (error) {
        console.error("Error filtering feeders by band: ", error);
        res.status(500).json({message: "Error filtering feeders by band."});
    }
}

// Filter Feeders by Region ID and Business Hub ID
export const filterFeedersByBHAndRegion = async (req: Request, res: Response): Promise<void> => {
    try {
        const { regionId, businessHubId } = req.query;
        const filter: any = {};

        if (regionId && typeof regionId === "string" && !isBlank(regionId)) {
            const region = await Region.findById(regionId);
            if (!region) {
                res.status(404).json({ message: "Region not found." });
                return;
            }
            filter.region = regionId;
        }

        if (businessHubId && typeof businessHubId === "string" && !isBlank(businessHubId)) {
            const businessHub = await BusinessHub.findById(businessHubId);
            if (!businessHub) {
                res.status(404).json({ message: "Business Hub not found." });
                return;
            }
            filter.businessHub = businessHubId;
        }

        if (Object.keys(filter).length === 0) {
            res.status(400).json({ message: "Please provide at least regionId or businessHubId." });
            return;
        }

        const feeders = await Feeder.find(filter)
            .populate('region', 'name')
            .populate('businessHub', 'name')
            .sort({ name: 1 });

        res.status(200).json(feeders);

    } catch (error) {
        console.error("Error filtering feeders:", error);
        res.status(500).json({ message: "Error filtering feeders." });
    }
};
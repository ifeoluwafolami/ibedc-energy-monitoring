import { Request, Response } from "express";
import { isBlank } from "../utils/isBlank";
import { BusinessHub } from "../models/businessHub.model";
import { Region } from "../models/region.model";

// Create a Business Hub
export const createBusinessHub = async (req: Request, res: Response): Promise<void> => {
    try {
        const { name, regionId, status } = req.body;

        if (isBlank(name) || isBlank(regionId)) {
            res.status(400).json({message: "Both name and region of business hub are required."});
            return;
        }

        const trimmedName = name.trim();

        const regionExists = await Region.findById(regionId);
        if (!regionExists) {
            res.status(400).json({message: "Specified region does not exist."});
            return;
        }

        const businessHubExists = await BusinessHub.findOne({ 
            name: trimmedName, 
            region: regionId 
        });
        
        if (businessHubExists) {
            res.status(400).json({message: "Business Hub already exists in this region."});
            return;
        }

        const businessHub = await BusinessHub.create({
            name: trimmedName,
            region: regionId,
            status: status || 'active'
        });

        await businessHub.populate('region');

        res.status(201).json({message: "Business Hub created successfully.", businessHub});

    } catch (error) {
        console.error("Error creating business hub: ", error);
        res.status(500).json({message: "Failed to create Business Hub."});
    }
}


// Fetch all Business Hubs
export const getAllBusinessHubs = async (req: Request, res: Response): Promise<void> => {
    try {
        const businessHubs = await BusinessHub
            .find()
            .populate('region', 'name') 
            .sort({ name: 1 });
            
        res.status(200).json(businessHubs);
    } catch (error) {
        console.error("Error fetching Business Hubs: ", error);
        res.status(500).json({message: "Failed to fetch business hubs."});
    }
}


// Fetch one Business Hub
export const getBusinessHub = async (req: Request, res: Response): Promise<void> => {
    try {
        const { id } = req.params;

        const businessHub = await BusinessHub
            .findById(id)
            .populate('region', 'name');

        if (!businessHub) {
            res.status(404).json({message: "Business Hub not found."});
            return;
        }

        res.status(200).json(businessHub);
    } catch (error) {
        console.error("Error fetching business hub: ", error);
        res.status(500).json({message: "Failed to fetch business hub."});
    }
}


// Update Business Hub
export const updateBusinessHub = async (req: Request, res: Response): Promise<void> => {
    try {
        const { name, regionId, status } = req.body;
        const { id } = req.params;

        if (isBlank(name) && isBlank(regionId) && isBlank(status)) {
            res.status(400).json({ message: "No update fields provided." });
            return;
        }

        const businessHub = await BusinessHub.findById(id);
        if (!businessHub) {
            res.status(404).json({ message: "Business Hub not found." });
            return;
        }

        const trimmedName = name?.trim();
        const updateData: any = {};

        if (trimmedName) {
            if (isBlank(trimmedName)) {
                res.status(400).json({ message: "Business hub name cannot be blank." });
                return;
            }
            updateData.name = trimmedName;
        }

        if (regionId) {
            const regionExists = await Region.findById(regionId);
            if (!regionExists) {
                res.status(400).json({ message: "Specified region does not exist." });
                return;
            }
            updateData.region = regionId;
        }

        if (status) {
            updateData.status = status;
        }

        const finalName = updateData.name || businessHub.name;
        const finalRegionId = updateData.region || businessHub.region;

        const conflict = await BusinessHub.findOne({
            name: finalName,
            region: finalRegionId,
            _id: { $ne: id }
        });

        if (conflict) {
            res.status(400).json({ message: "Business hub with this name and region already exists." });
            return;
        }

        const updatedBusinessHub = await BusinessHub
            .findByIdAndUpdate(id, updateData, { new: true, runValidators: true })
            .populate('region', 'name');

        res.status(200).json({ 
            message: "Business Hub updated successfully.", 
            businessHub: updatedBusinessHub 
        });

    } catch (error) {
        console.error("Error updating business hub:", error);
        res.status(500).json({ message: "Failed to update business hub." });
    }
};


// Delete business hub
export const deleteBusinessHub = async(req: Request, res: Response): Promise<void> => {
    try {
        const { id } = req.params;

        const businessHub = await BusinessHub.findByIdAndDelete(id);

        if (!businessHub) {
            res.status(404).json({message: "Business hub not found."});
            return;
        }

        res.status(200).json({message: "Business hub deleted successfully."});

    } catch (error) {
        console.error("Error deleting business hub: ", error);
        res.status(500).json({message: "Failed to delete business hub."});
    }
}


// Filter Business Hubs By Region 
export const filterBusinessHubsByRegion = async (req: Request, res: Response): Promise<void> => {
    try {
        const regionId = req.query.regionId as string;
        
        if (!regionId || isBlank(regionId)) {
            res.status(400).json({message: "Region ID is required."});
            return;
        }

        const regionExists = await Region.findById(regionId);
        if (!regionExists) {
            res.status(404).json({ message: "Region not found." });
            return;
        }

        const businessHubsInRegion = await BusinessHub
            .find({ region: regionId })
            .populate('region', 'name')
            .sort({ name: 1 });

        res.status(200).json({
            region: regionExists,
            businessHubs: businessHubsInRegion,
            total: businessHubsInRegion.length
        });

    } catch (error) {
        console.error("Error filtering business hubs by region: ", error);
        res.status(500).json({message: "Error filtering business hubs by region."});
    }
}
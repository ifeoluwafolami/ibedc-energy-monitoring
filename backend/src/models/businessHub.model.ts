import { Document, model, Schema, Types } from "mongoose";

export interface IBusinessHub extends Document {
    _id: Types.ObjectId;
    name: string;
    region: Types.ObjectId;
    status: 'active' | 'inactive';
    createdAt: Date;
    updatedAt: Date;
}

const BusinessHubSchema = new Schema(
    {
        name: {
            type: String,
            required: true,
            trim: true
        },
        region: {
            type: Schema.Types.ObjectId,
            ref: 'Region',
            required: true
        },
        status: {
            type: String,
            enum: ['active', 'inactive'],
            default: 'active'
        }
    },
    {
        timestamps: true
    }
);

BusinessHubSchema.index({ region: 1 });
BusinessHubSchema.index({ status: 1 });
BusinessHubSchema.index({ region: 1, status: 1 });

BusinessHubSchema.pre('save', async function(next) {
    if (this.isModified('name') || this.isModified('region')) {
        const normalizedName = this.name.toLowerCase().replace(/[\s-]/g, '');
        
        const businessHubs = await model('BusinessHub').find({ 
            region: this.region,
            _id: { $ne: this._id }
        });
        
        const duplicate = businessHubs.find(hub => 
            hub.name.toLowerCase().replace(/[\s-]/g, '') === normalizedName
        );
        
        if (duplicate) {
            const error = new Error(`Business Hub similar to '${this.name}' already exists in this region as '${duplicate.name}'`);
            return next(error);
        }
    }
    next();
});

export const BusinessHub = model<IBusinessHub>('BusinessHub', BusinessHubSchema);
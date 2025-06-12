import { Document, model, Schema, Types } from "mongoose";

export interface IRegion extends Document {
    _id: Types.ObjectId;
    name: string;
    createdAt: Date;
    updatedAt: Date;
}

const RegionSchema = new Schema(
    {
        name: {
            type: String,
            required: true,
            unique: true,
            trim: true
        }
    }, 
    {
        timestamps: true
    }
);

RegionSchema.index({ name: 1 });
RegionSchema.index({ createdAt: -1 });

RegionSchema.pre('save', async function(next) {
    if (this.isModified('name')) {
        const normalizedName = this.name.toLowerCase().replace(/[\s-]/g, '');        
        const regions = await model('Region').find({ _id: { $ne: this._id } });        
        const duplicate = regions.find(region => 
            region.name.toLowerCase().replace(/[\s-]/g, '') === normalizedName
        );
        if (duplicate) {
            const error = new Error(`Region similar to '${this.name}' already exists as '${duplicate.name}'`);
            return next(error);
        }
    }
    next();
});

export const Region = model<IRegion>('Region', RegionSchema);
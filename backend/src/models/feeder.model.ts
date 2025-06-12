import { Document, model, Schema, Types } from "mongoose";

export interface IFeeder extends Document {
    _id: Types.ObjectId;
    name: string;
    businessHub: Types.ObjectId;
    region: Types.ObjectId;
    band: 'A20H' | 'B16H' | 'C12H' | 'D8H' | 'E4H';
    dailyEnergyUptake: number;
    monthlyDeliveryPlan: number;
    previousMonthConsumption: number;
    status: 'active' | 'inactive';
    createdAt: Date;
    updatedAt: Date;
}

const feederSchema = new Schema<IFeeder>(
    {
        name: {
            type: String,
            required: true,
            trim: true
        },
        businessHub: {
            type: Schema.Types.ObjectId,
            ref: 'BusinessHub',
            required: true
        },
        region: {
            type: Schema.Types.ObjectId,
            ref: 'Region',
            required: true
        },
        band: {
            type: String,
            enum: ['A20H', 'B16H', 'C12H', 'D8H', 'E4H'],
            required: true,
            trim: true
        },
        dailyEnergyUptake: {
            type: Number,
            required: true,
            min: [0, 'Daily energy uptake cannot be negative']
        },
        monthlyDeliveryPlan: {
            type: Number,
            required: true,
            min: [0, 'Monthly delivery plan cannot be negative']
        },
        previousMonthConsumption: {
            type: Number,
            required: true,
            min: [0, 'Previous month consumption cannot be negative']
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

feederSchema.index({ region: 1 });
feederSchema.index({ band: 1 });
feederSchema.index({ status: 1 });
feederSchema.index({ region: 1, businessHub: 1 });
feederSchema.index({ region: 1, band: 1 });
feederSchema.index({ region: 1, band: 1, status: 1 });

feederSchema.pre('save', async function (next) {
    if (this.isModified('businessHub') || this.isModified('region')) {
        const businessHub = await model('BusinessHub').findById(this.businessHub);
        if (!businessHub) {
            return next(new Error('Business Hub not found'));
        }
        if (!businessHub.region.equals(this.region)) {
            return next(new Error("Region must match business hub's region"));
        }
    }
    
    if (this.isModified('name') || this.isModified('businessHub') || this.isModified('region')) {
        const normalizedName = this.name.toLowerCase().replace(/[\s-]/g, '');
        const feeders = await model('Feeder').find({
            region: this.region,
            businessHub: this.businessHub,
            _id: { $ne: this._id }
        });

        const duplicate = feeders.find(feeder => 
            feeder.name.toLowerCase().replace(/[\s-]/g, '') === normalizedName
        );

        if (duplicate) {
            const error = new Error(`Feeder similar to '${this.name}' already exists in this business hub as '${duplicate.name}'`);
            return next(error);
        }
    }
    
    next();
});

export const Feeder = model<IFeeder>('Feeder', feederSchema);
import { Document, model, Schema, Types } from "mongoose";

interface IFeederReadingHistory {
    date: Date;
    cumulativeEnergyConsumption: number;
    updatedAt: Date;
    updatedBy: Types.ObjectId;
}

export interface IFeederReading extends Document {
    date: Date;
    feeder: Types.ObjectId;
    cumulativeEnergyConsumption: number;
    recordedBy: Types.ObjectId;
    history: IFeederReadingHistory[];
    createdAt: Date;
    updatedAt: Date;
    addToHistory(): void;
}

const FeederReadingSchema = new Schema<IFeederReading>(
    {
        date: {
            type: Date,
            required: true,
            validate: {
                validator: function(value: Date) {
                    return value <= new Date();
                },
                message: 'Reading date cannot be in the future'
            }
        },
        feeder: {
            type: Schema.Types.ObjectId,
            ref: 'Feeder',
            required: true
        },
        cumulativeEnergyConsumption: {
            type: Number,
            required: true,
            min: [0, 'Energy consumption cannot be negative']
        },
        recordedBy: {
            type: Schema.Types.ObjectId,
            ref: "User",
            required: true
        },
        history: [{
            date: {
                type: Date,
                required: true
            },
            cumulativeEnergyConsumption: {
                type: Number,
                required: true,
                min: 0
            },
            updatedAt: {
                type: Date,
                default: Date.now,
                required: true
            },
            updatedBy: {
                type: Schema.Types.ObjectId,
                ref: 'User',
                required: true
            }
        }]
    }, 
    {
        timestamps: true
    }
);

FeederReadingSchema.index({ feeder: 1, date: 1 }, { unique: true });

FeederReadingSchema.methods.addToHistory = function() {
    this.history.push({
        date: this.date,
        cumulativeEnergyConsumption: this.cumulativeEnergyConsumption,
        updatedAt: new Date(),
        updatedBy: this.recordedBy
    });
};

FeederReadingSchema.pre('save', function(next) {
    if (this.isModified('cumulativeEnergyConsumption') && !this.isNew) {
        this.addToHistory();
    }
    next();
});

export const FeederReading = model<IFeederReading>("FeederReading", FeederReadingSchema);
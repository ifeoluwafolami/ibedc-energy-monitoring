import { Document, model, Schema, Types } from "mongoose";

export interface ISignupRequest extends Document {
    name: string;
    email: string;
    password: string;
    businessHub: Types.ObjectId;
    region: Types.ObjectId;
    status: 'pending' | 'approved' | 'denied';
    processedBy?: Types.ObjectId;
    processedAt?: Date;
    denialReason?: string;
    createdAt: Date;
    updatedAt: Date;
}

const signupRequestSchema = new Schema<ISignupRequest>(
    {
        name: {
            type: String,
            required: true,
            trim: true,
            minlength: [2, 'Name must be at least 2 characters long'],
            maxlength: [100, 'Name cannot exceed 100 characters']
        },
        email: {
            type: String,
            required: true,
            trim: true,
            unique: true,
            lowercase: true,
            validate: {
                validator: function(email: string) {
                    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
                },
                message: 'Please provide a valid email address'
            }
        },
        password: {
            type: String,
            required: true,
            minlength: [8, 'Password must be at least 8 characters long']
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
        status: {
            type: String,
            enum: {
                values: ['pending', 'approved', 'denied'],
                message: 'Status must be either pending, approved, or denied'
            },
            default: 'pending',
            required: true,
            trim: true
        },
        processedBy: {
            type: Schema.Types.ObjectId,
            ref: 'User',
            required: function() {
                return this.status !== 'pending';
            }
        },
        processedAt: {
            type: Date,
            required: function() {
                return this.status !== 'pending';
            }
        },
        denialReason: {
            type: String,
            trim: true,
            required: function() {
                return this.status === 'denied';
            },
            maxlength: [500, 'Denial reason cannot exceed 500 characters']
        }
    },
    {
        timestamps: true
    }
);

signupRequestSchema.index({ status: 1 });
signupRequestSchema.index({ createdAt: -1 });
signupRequestSchema.index({ email: 1, status: 1 });
signupRequestSchema.index({ businessHub: 1, status: 1 });

signupRequestSchema.pre('save', function(next) {
    if (this.isModified('status') && this.status !== 'pending') {
        this.processedAt = new Date();
    }
    next();
});

export const SignupRequest = model<ISignupRequest>('SignupRequest', signupRequestSchema);
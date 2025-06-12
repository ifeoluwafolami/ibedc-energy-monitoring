import { Document, model, Schema, Types } from "mongoose";

export interface IUser extends Document {
    name: string;
    email: string;
    password: string;
    isAdmin: boolean;
    businessHub: Types.ObjectId;
    region: Types.ObjectId;
    createdAt: Date;
    updatedAt: Date;
}

const userSchema = new Schema<IUser>(
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
            unique: true,
            trim: true,
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
        isAdmin: {
            type: Boolean,
            default: false,
            required: true
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
        }
    },
    {
        timestamps: true
    }
);

userSchema.index({ email: 1 });
userSchema.index({ region: 1 });
userSchema.index({ region: 1, businessHub: 1 });
userSchema.index({ isAdmin: 1 });

export const User = model<IUser>('User', userSchema);
import mongoose from "mongoose";
import dotenv from "dotenv";
dotenv.config();

const connectDB = async () => {
    try {
        await mongoose.connect(process.env.MONGO_URI as string);
        console.log("Database connected.");
    } catch (error) {
        console.error(error);
        process.exit(1);
    }
}
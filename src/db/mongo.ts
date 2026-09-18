import mongoose from 'mongoose';
import { env } from '../config/env';

export async function connectMongo(url: string = env.mongoUrl): Promise<typeof mongoose> {
  mongoose.set('strictQuery', true);
  await mongoose.connect(url);
  // eslint-disable-next-line no-console
  console.log(`[mongo] connected: ${url}`);
  return mongoose;
}

export async function disconnectMongo(): Promise<void> {
  await mongoose.disconnect();
}

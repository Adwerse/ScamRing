import { MongoClient, type Db } from 'mongodb';

const DB_NAME = 'scamring';

const g = globalThis as unknown as { _mongoClient?: Promise<MongoClient> };

export function getClient(): Promise<MongoClient> {
  if (!g._mongoClient) {
    const uri = process.env.MONGODB_URI;
    if (!uri) throw new Error('MONGODB_URI is not set');
    g._mongoClient = new MongoClient(uri).connect();
  }
  return g._mongoClient;
}

export async function getDb(): Promise<Db> {
  return (await getClient()).db(DB_NAME);
}

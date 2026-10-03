import { MongoClient, type Db } from 'mongodb';

const g = globalThis as unknown as { _mongoClient?: Promise<MongoClient> };

export async function getClient(): Promise<MongoClient> {
  if (!g._mongoClient) {
    const uri = process.env.MONGODB_URI;
    if (!uri) throw new Error('MONGODB_URI is not set');
    g._mongoClient = new MongoClient(uri).connect();
  }
  return g._mongoClient;
}

export function getDbName(): string {
  return process.env.DB_NAME || 'scamring';
}

export async function getDb(): Promise<Db> {
  return (await getClient()).db(getDbName());
}

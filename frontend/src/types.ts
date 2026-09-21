import { Timestamp } from 'firebase/firestore';

export type Difficulty = 'Easy' | 'Medium' | 'Hard';

export interface Question {
  id: string;
  userId: string;
  number: number;
  title: string;
  url: string;
  difficulty: Difficulty;
  userRating: Difficulty;
  notes: string;
  createdAt: Timestamp;
  nextReviewAt: Timestamp;
  reviewCount: number;
  isCompleted: boolean;
}

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId: string | undefined;
    email: string | null | undefined;
    emailVerified: boolean | undefined;
    isAnonymous: boolean | undefined;
    tenantId: string | null | undefined;
    providerInfo: {
      providerId: string;
      displayName: string | null;
      email: string | null;
      photoUrl: string | null;
    }[];
  };
}

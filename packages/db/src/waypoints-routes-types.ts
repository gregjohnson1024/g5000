// packages/db/src/waypoints-routes-types.ts

/** A single named point. Stored as one of a Waypoint[] blob in ConfigStore. */
export interface Waypoint {
  id: string;
  name: string;
  lat: number;
  lon: number;
  /** Optional free-form notes. */
  notes?: string;
  /** Set on create, ISO 8601. */
  createdAt: string;
}

/** An ordered list of references to saved waypoints. */
export interface Route {
  id: string;
  name: string;
  /** Ordered waypoint ids. Every id must exist in the waypoints table. */
  waypointIds: string[];
  notes?: string;
  createdAt: string; // ISO 8601
  updatedAt: string; // ISO 8601
}

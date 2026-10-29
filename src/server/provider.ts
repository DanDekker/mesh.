import type { FieldSettings, Pointer, WheelKick } from '../shared/field.ts';

// Only this data contract is public. Implementations live outside the repository
// and are imported by the server only. They never enter a browser bundle.
export type FieldTopology = { count: number; rows: number; columns: number; hz: number; positions: Float32Array; edges: Uint16Array };
export type FieldPulse = { x: number; y: number; z: number; force?: number };
export type FieldFling = { index: number; vx: number; vy: number; vz: number };
export type FieldInput = { elapsedNanoseconds: number; settings: FieldSettings; pointer: Pointer; pulses: FieldPulse[]; kicks?: WheelKick[]; flings?: FieldFling[]; reset: boolean };
export type FieldFrame = { positions: Float32Array; time: number };
export interface PrivateField { advance(input: FieldInput): FieldFrame; dispose(): void }
export type PrivateFactory = (topology: FieldTopology) => PrivateField;

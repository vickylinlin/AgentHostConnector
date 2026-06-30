import type { RuntimeStatus, ToolSummary } from '../types.js';
import type { SkillSummary } from '../skills.js';
export declare function renderAdminPage(): string;
export declare function renderStatusSummary(status: RuntimeStatus): string;
export type { RuntimeStatus, SkillSummary, ToolSummary };

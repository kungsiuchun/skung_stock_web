/**
 * Agent Framework — Skill System
 * Mirrors the Python blueprint's SkillManager.
 * Injects strategy instructions into the LLM system prompt dynamically.
 */

import { BUILTIN_STRATEGIES, StrategySpec } from "../strategies";

export interface Skill {
  name: string;
  source: string;
  enabled: boolean;
  spec: StrategySpec;
}

export class SkillManager {
  private skills: Map<string, Skill> = new Map();

  constructor() {
    this.loadBuiltinStrategies();
  }

  private loadBuiltinStrategies() {
    for (const [name, spec] of Object.entries(BUILTIN_STRATEGIES)) {
      this.skills.set(name, {
        name,
        source: "builtin",
        enabled: false,
        spec,
      });
    }
  }

  /**
   * Activate specific skills by name.
   */
  activate(skillNames: string[]): void {
    for (const name of skillNames) {
      const skill = this.skills.get(name);
      if (skill) {
        skill.enabled = true;
      } else {
        console.warn(`[SkillManager] Warning: Skill '${name}' not found.`);
      }
    }
  }

  /**
   * Generate the combined instruction string to inject into the system prompt.
   */
  getSkillInstructions(): string {
    const activeSkills = Array.from(this.skills.values()).filter((s) => s.enabled);

    if (activeSkills.length === 0) {
      return "";
    }

    const sections = activeSkills.map((s) => s.spec.instructions.trim());

    return `
=============================================
【啟用交易策略框架 (Active Trading Strategies)】
=============================================
你目前已啟用了以下交易策略，請嚴格按照這些策略的指示進行分析：

${sections.join("\n\n---\n\n")}
=============================================
`;
  }

  /**
   * Get all required tools for the currently active skills.
   */
  getRequiredTools(): string[] {
    const activeSkills = Array.from(this.skills.values()).filter((s) => s.enabled);
    const tools = new Set<string>();
    
    for (const s of activeSkills) {
      for (const t of s.spec.required_tools) {
        tools.add(t);
      }
    }
    
    return Array.from(tools);
  }
}

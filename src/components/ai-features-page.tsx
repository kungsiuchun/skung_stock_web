"use client";

import { ImageIcon, MessageSquare, Wand2, Bot, Users } from "lucide-react";
import { GlowingEffect } from "@/components/ui/glowing-effect";
import { cn } from "@/lib/utils";

interface AIFeaturesPageProps {
  onOpenCaptionTool: () => void;
  onOpenFinanceTool: () => void;
  onOpenFinRobotTool: () => void;
  onOpenTradingAgentTool: () => void;
}

export function AIFeaturesPage({ onOpenCaptionTool, onOpenFinanceTool, onOpenFinRobotTool, onOpenTradingAgentTool }: AIFeaturesPageProps) {
  return (
    <div className="w-full h-full flex flex-col items-center justify-center p-6 sm:p-12 z-10 pointer-events-auto overflow-y-auto pt-32">
      <div className="max-w-5xl w-full">
        <div className="mb-12 text-center">
          <h2 className="text-3xl md:text-5xl font-bold tracking-tighter text-white mb-4">
            AI Vision & Features
          </h2>
          <p className="text-white/50 max-w-2xl mx-auto">
            Explore our cutting-edge AI capabilities. Seamlessly integrate advanced machine learning models into your daily workflow.
          </p>
        </div>

        <ul className="grid grid-cols-1 grid-rows-none gap-4 md:grid-cols-12 md:grid-rows-3 lg:gap-4 xl:max-h-[34rem] xl:grid-rows-2">
          <GridItem
            area="md:[grid-area:1/1/2/7] xl:[grid-area:1/1/2/5]"
            icon={<ImageIcon className="h-4 w-4" />}
            title="Image to Caption"
            description="Use Cloudflare Workers AI to automatically generate rich descriptions from any uploaded image."
            onClick={onOpenCaptionTool}
            className="cursor-pointer hover:scale-[1.02] transition-transform"
          />
          <GridItem
            area="md:[grid-area:1/7/2/13] xl:[grid-area:2/1/3/5]"
            icon={<MessageSquare className="h-4 w-4" />}
            title="Finance Analyzer"
            description="Engage with an intelligent agent powered by StepFun 3.5 Flash to analyze stock trends over 20 days."
            onClick={onOpenFinanceTool}
            className="cursor-pointer hover:scale-[1.02] transition-transform"
          />
          <GridItem
            area="md:[grid-area:2/1/3/7] xl:[grid-area:1/5/3/8]"
            icon={<Bot className="h-4 w-4" />}
            title="FinRobot Analyst"
            description="Automated intelligent agent for real-time equity research powered by FinRobot multi-agent logic."
            onClick={onOpenFinRobotTool}
            className="cursor-pointer hover:scale-[1.02] transition-transform"
          />
          <GridItem
            area="md:[grid-area:2/7/3/13] xl:[grid-area:1/8/2/13]"
            icon={<Users className="h-4 w-4" />}
            title="Trading Agent (Multi-Role)"
            description="A multi-agent committee utilizing Alpha Vantage and Technical Analysis for comprehensive trading strategies."
            onClick={onOpenTradingAgentTool}
            className="cursor-pointer hover:scale-[1.02] transition-transform"
          />
          <GridItem
            area="md:[grid-area:3/1/4/13] xl:[grid-area:2/8/3/13]"
            icon={<Wand2 className="h-4 w-4" />}
            title="Coming Soon: Image Gen"
            description="Text-to-image generation powered by state-of-the-art diffusion models. Stay tuned!"
          />
        </ul>
      </div>
    </div>
  );
}

interface GridItemProps {
  area: string;
  icon: React.ReactNode;
  title: string;
  description: React.ReactNode;
  onClick?: () => void;
  className?: string;
}

const GridItem = ({ area, icon, title, description, onClick, className }: GridItemProps) => {
  return (
    <li className={cn("min-h-[14rem] list-none", area, className)} onClick={onClick}>
      <div className="relative h-full rounded-[1.25rem] border-[0.75px] border-white/10 p-2 md:rounded-[1.5rem] md:p-3 bg-black/20">
        <GlowingEffect
          spread={40}
          glow={true}
          disabled={false}
          proximity={64}
          inactiveZone={0.01}
          borderWidth={3}
        />
        <div className="relative flex h-full flex-col justify-between gap-6 overflow-hidden rounded-xl border-[0.75px] border-white/10 bg-black/40 p-6 shadow-sm dark:shadow-[0px_0px_27px_0px_rgba(45,45,45,0.3)] md:p-6 backdrop-blur-sm hover:bg-black/60 transition-colors">
          <div className="relative flex flex-1 flex-col justify-between gap-3">
            <div className="w-fit rounded-lg border-[0.75px] border-white/20 bg-white/10 p-2 text-white">
              {icon}
            </div>
            <div className="space-y-3">
              <h3 className="pt-0.5 text-xl leading-[1.375rem] font-semibold font-sans tracking-[-0.04em] md:text-2xl md:leading-[1.875rem] text-balance text-white">
                {title}
              </h3>
              <h2 className="[&_b]:md:font-semibold [&_strong]:md:font-semibold font-sans text-sm leading-[1.125rem] md:text-base md:leading-[1.375rem] text-white/60">
                {description}
              </h2>
            </div>
          </div>
        </div>
      </div>
    </li>
  );
};

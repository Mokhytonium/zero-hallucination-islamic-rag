import React, { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { ThinkingStep } from '../types';
import { toPersianDigits } from '../lib/format';

interface Props {
  steps: ThinkingStep[];
  meta?: {
    hops: number;
    latency: string;
    verifiedCount: number;
    modelName?: string;
  };
}

export const ThinkingAccordion: React.FC<Props> = ({ steps, meta }) => {
  const [open, setOpen] = useState(false);

  return (
    <div className="mb-3">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className="inline-flex items-center gap-1.5 text-xs text-muted hover:text-ink transition-colors py-1"
      >
        <ChevronDown
          className={`w-3.5 h-3.5 transition-transform duration-300 ease-smooth ${
            open ? 'rotate-0' : '-rotate-90'
          }`}
        />
        <span>
          {meta
            ? `مسیر استدلال (${toPersianDigits(meta.hops)} مرحله، ${toPersianDigits(
                meta.verifiedCount
              )} آیه، ${meta.latency})`
            : 'مسیر استدلال'}
        </span>
      </button>

      <div
        className={`grid transition-[grid-template-rows,opacity] duration-300 ease-smooth ${
          open ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'
        }`}
      >
        <div className="overflow-hidden">
          <div className="mt-2 mr-2 pr-4 border-r border-hairlineStrong space-y-3 py-1">
            {steps.map((step, idx) => (
              <div
                key={idx}
                className={`text-xs space-y-1 ${open ? 'animate-rise' : ''}`}
                style={open ? { animationDelay: `${idx * 45}ms` } : undefined}
              >
                <div className="font-medium text-ink">
                  {toPersianDigits(step.hop)}. {step.title}
                </div>
                {step.detail && <p className="text-muted leading-5">{step.detail}</p>}
                {step.queries && step.queries.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 pt-0.5">
                    {step.queries.map((q, qIdx) => (
                      <span
                        key={qIdx}
                        className="text-[11px] bg-parchment border border-hairline px-2 py-0.5 rounded text-inkSoft transition-colors duration-200 hover:border-hairlineStrong"
                      >
                        {q}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

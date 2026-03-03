import { useState } from 'react';
import { useProjectStore } from '../../stores/useProjectStore';

type SliderProps = {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
  displayValue?: string;
};

const Slider = ({ label, value, min, max, step, onChange, displayValue }: SliderProps) => (
  <div className="mb-3">
    <div className="flex justify-between text-xs text-text-muted mb-1">
      <span>{label}</span>
      <span className="font-mono text-text-primary">{displayValue ?? value.toFixed(2)}</span>
    </div>
    <input
      type="range"
      min={min}
      max={max}
      step={step}
      value={value}
      onChange={(e) => onChange(parseFloat(e.target.value))}
      className="w-full h-1.5 accent-accent cursor-pointer"
    />
    <div className="flex justify-between text-[10px] text-text-muted mt-0.5">
      <span>{min}</span>
      <span>{max}</span>
    </div>
  </div>
);

const EffectsPanel = () => {
  const { clips, activeClipId, setClipEffects, setClipSpeed } = useProjectStore();
  const activeClip = clips.find((c) => c.id === activeClipId);
  const effects = activeClip?.effects ?? {};
  const speed = activeClip?.speed ?? 1;

  const [localEffects, setLocalEffects] = useState<typeof effects>({});
  const [localSpeed, setLocalSpeed] = useState<number | null>(null);

  // Derived display values
  const brightness = localEffects.brightness ?? effects.brightness ?? 0;
  const contrast = localEffects.contrast ?? effects.contrast ?? 1;
  const saturation = localEffects.saturation ?? effects.saturation ?? 1;
  const gamma = localEffects.gamma ?? effects.gamma ?? 1;
  const displaySpeed = localSpeed ?? speed;

  const handleEffectChange = (key: keyof typeof effects, value: number) => {
    const updated = { ...localEffects, [key]: value };
    setLocalEffects(updated);
    if (activeClipId) {
      setClipEffects(activeClipId, { brightness, contrast, saturation, gamma, ...updated });
    }
  };

  const handleSpeedChange = (val: number) => {
    setLocalSpeed(val);
    if (activeClipId) setClipSpeed(activeClipId, val);
  };

  const handleReset = () => {
    setLocalEffects({});
    setLocalSpeed(null);
    if (activeClipId) {
      setClipEffects(activeClipId, { brightness: 0, contrast: 1, saturation: 1, gamma: 1 });
      setClipSpeed(activeClipId, 1);
    }
  };

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="p-4 border-b border-border-primary sticky top-0 bg-bg-elevated z-10">
        <div className="flex items-center gap-2 mb-1">
          <svg
            className="w-5 h-5 text-accent"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="2"
              d="M7 21a4 4 0 01-4-4V5a2 2 0 012-2h4a2 2 0 012 2v12a4 4 0 01-4 4zm0 0h12a2 2 0 002-2v-4a2 2 0 00-2-2h-2.343M11 7.343l1.657-1.657a2 2 0 012.828 0l2.829 2.829a2 2 0 010 2.828l-8.486 8.485M7 17h.01"
            />
          </svg>
          <h3 className="text-sm font-bold text-text-primary">Effects & Filters</h3>
        </div>
        <p className="text-xs text-text-muted">
          {activeClip ? `Editing: ${activeClip.name}` : 'Select a clip to adjust its effects'}
        </p>
      </div>

      <div className="p-4">
        {!activeClip ? (
          <div className="flex flex-col items-center justify-center py-12 text-center text-text-muted">
            <svg
              className="w-12 h-12 mb-3 opacity-30"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="1.5"
                d="M15 15l-2 5L9 9l11 4-5 2zm0 0l5 5"
              />
            </svg>
            <p className="text-sm">Click a clip in the timeline to select it</p>
          </div>
        ) : (
          <>
            {/* Speed */}
            <div className="mb-5">
              <h4 className="text-xs font-bold text-text-primary uppercase tracking-wider mb-3 flex items-center gap-2">
                <svg
                  className="w-3.5 h-3.5 text-accent"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="2"
                    d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
                  />
                </svg>
                Speed
              </h4>
              <div className="flex gap-1 mb-2">
                {[0.25, 0.5, 1, 1.5, 2, 4].map((p) => (
                  <button
                    key={p}
                    onClick={() => handleSpeedChange(p)}
                    className={`flex-1 text-[10px] py-1 rounded ${displaySpeed === p ? 'bg-accent text-white' : 'bg-bg-secondary text-text-muted hover:text-text-primary'}`}
                  >
                    {p}x
                  </button>
                ))}
              </div>
              <Slider
                label="Speed"
                value={displaySpeed}
                min={0.25}
                max={4}
                step={0.25}
                onChange={handleSpeedChange}
                displayValue={`${displaySpeed}x`}
              />
            </div>

            {/* Color Correction */}
            <div className="mb-5">
              <h4 className="text-xs font-bold text-text-primary uppercase tracking-wider mb-3 flex items-center gap-2">
                <svg
                  className="w-3.5 h-3.5 text-accent"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="2"
                    d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z"
                  />
                </svg>
                Color Correction
              </h4>
              <Slider
                label="Brightness"
                value={brightness}
                min={-1}
                max={1}
                step={0.05}
                onChange={(v) => handleEffectChange('brightness', v)}
              />
              <Slider
                label="Contrast"
                value={contrast}
                min={0}
                max={3}
                step={0.1}
                onChange={(v) => handleEffectChange('contrast', v)}
              />
              <Slider
                label="Saturation"
                value={saturation}
                min={0}
                max={3}
                step={0.1}
                onChange={(v) => handleEffectChange('saturation', v)}
              />
              <Slider
                label="Gamma"
                value={gamma}
                min={0.1}
                max={3}
                step={0.1}
                onChange={(v) => handleEffectChange('gamma', v)}
              />
            </div>

            {/* CSS Preview hint */}
            <div className="mb-4 p-2 rounded bg-bg-secondary border border-border-primary text-xs text-text-muted">
              <span className="text-accent font-bold"></span> Effects applied on export via FFmpeg{' '}
              <code className="text-text-primary">eq</code> filter.
            </div>

            <button
              onClick={handleReset}
              className="w-full py-1.5 rounded bg-bg-secondary hover:bg-red-900/30 border border-border-primary hover:border-red-500/50 text-text-muted hover:text-red-400 text-xs transition-colors"
            >
              Reset All Effects
            </button>
          </>
        )}
      </div>
    </div>
  );
};

export default EffectsPanel;

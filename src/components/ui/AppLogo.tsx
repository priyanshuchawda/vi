import clsx from 'clsx';
import quickcutLogo from '../../assets/quickcut-logo.png';

interface AppLogoProps {
  className?: string;
  iconClassName?: string;
  nameClassName?: string;
  showWordmark?: boolean;
  showTagline?: boolean;
  size?: number;
  wordmarkClassName?: string;
}

export function AppLogo({
  className,
  iconClassName,
  nameClassName,
  showWordmark = false,
  showTagline = false,
  size = 36,
  wordmarkClassName,
}: AppLogoProps) {
  return (
    <div className={clsx('flex items-center gap-3', className)}>
      <img
        src={quickcutLogo}
        alt="QuickCut"
        width={size}
        height={size}
        className={clsx('shrink-0 rounded-xl object-contain', iconClassName)}
      />
      {showWordmark ? (
        <div className={clsx('min-w-0', wordmarkClassName)}>
          <div
            className={clsx(
              'text-[13px] font-semibold tracking-tight text-text-primary',
              nameClassName,
            )}
          >
            QuickCut
          </div>
          {showTagline ? (
            <div className="text-[10px] uppercase tracking-[0.18em] text-text-muted">
              AI Video Editor
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

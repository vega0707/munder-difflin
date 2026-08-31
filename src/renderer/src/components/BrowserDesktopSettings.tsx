import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { HarnessConfig } from '@/store/config';
import { PixelButton } from './PixelButton';

type BridgeStatus = {
  listening: boolean;
  extensionConnected: boolean;
  port: number;
};

type DesktopPermissions = {
  accessibility: boolean;
  screenCapture: boolean;
};

type BrowserDesktopConfig = HarnessConfig & {
  browserBridgeToken?: string;
  browserBridgePort?: number;
};

export interface BrowserDesktopSettingsProps {
  config: HarnessConfig;
}

const labelStyle: React.CSSProperties = {
  fontFamily: 'var(--cth-font-display)',
  fontSize: 8,
  lineHeight: '12px',
  color: 'var(--cth-ink-500)',
  textTransform: 'uppercase'
};

function PermissionRow({
  label,
  granted,
  openLabel,
  onOpen
}: {
  label: string;
  granted: boolean;
  openLabel: string;
  onOpen: () => void;
}) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 12,
        padding: '7px 10px',
        background: 'var(--cth-paper-100)',
        boxShadow: `inset 0 0 0 1px ${granted ? 'var(--cth-mint-700, #1f7a4d)' : 'var(--cth-ink-300)'}`
      }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2, flex: 1, minWidth: 0 }}>
        <span style={{ fontSize: 12, lineHeight: '18px', color: 'var(--cth-ink-900)', fontWeight: 600 }}>
          {label}
        </span>
        <span style={{
          fontSize: 12,
          lineHeight: '16px',
          color: granted ? 'var(--cth-mint-700, #1f7a4d)' : 'var(--cth-ink-500)'
        }}>
          {granted ? '✓' : '○'}
        </span>
      </div>
      <PixelButton variant="secondary" size="sm" onClick={onOpen}>
        {openLabel}
      </PixelButton>
    </div>
  );
}

export function BrowserDesktopSettings({ config }: BrowserDesktopSettingsProps) {
  const { t } = useTranslation();
  const cfg = config as BrowserDesktopConfig;
  const [bridgeStatus, setBridgeStatus] = useState<BridgeStatus | null>(null);
  const [permissions, setPermissions] = useState<DesktopPermissions | null>(null);
  const [token, setToken] = useState(cfg.browserBridgeToken ?? '');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const [bs, ps] = await Promise.all([
        window.cth.browserBridgeStatus(),
        window.cth.desktopControlPermissionStatus()
      ]);
      setBridgeStatus(bs);
      setPermissions(ps);
    } catch {
      /* best-effort poll */
    }
  }, []);

  useEffect(() => {
    void refresh();
    const id = setInterval(() => { void refresh(); }, 3000);
    return () => clearInterval(id);
  }, [refresh]);

  useEffect(() => {
    setToken(cfg.browserBridgeToken ?? '');
  }, [cfg.browserBridgeToken]);

  const copyToken = async () => {
    if (!token) return;
    const r = await window.cth.copyToClipboard(token);
    if (r.ok) {
      setNote(t('browserDesktop.tokenCopied'));
      setTimeout(() => setNote(''), 1800);
    }
  };

  const regenerate = async () => {
    setBusy(true);
    try {
      const { token: newToken } = await window.cth.browserBridgeRegenerateToken();
      setToken(newToken);
      setNote(t('browserDesktop.tokenRegenerated'));
      setTimeout(() => setNote(''), 2500);
      void refresh();
    } catch {
      setNote(t('browserDesktop.tokenRegenerateFailed'));
      setTimeout(() => setNote(''), 2000);
    } finally {
      setBusy(false);
    }
  };

  const port = bridgeStatus?.port ?? cfg.browserBridgePort ?? 9777;
  const connected = bridgeStatus?.extensionConnected === true;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div>
        <div style={{ ...labelStyle, marginBottom: 6 }}>{t('browserDesktop.title')}</div>
        <span style={{ fontSize: 12, lineHeight: '16px', color: 'var(--cth-ink-500)' }}>
          {t('browserDesktop.desc')}
        </span>
      </div>

      <div
        style={{
          padding: '10px 12px',
          background: 'var(--cth-coral-light, #f6d3c4)',
          boxShadow: 'inset 0 0 0 1px #6E1423'
        }}
      >
        <span style={{ fontSize: 12, lineHeight: '16px', color: '#6E1423', fontWeight: 600 }}>
          {t('browserDesktop.warning')}
        </span>
      </div>

      {/* Browser extension */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
          <span style={labelStyle}>{t('browserDesktop.browserTitle')}</span>
          <span style={{ fontSize: 11, lineHeight: '15px', color: 'var(--cth-ink-400, var(--cth-ink-500))' }}>
            {t('browserDesktop.browserDesc')}
          </span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span
            style={{
              padding: '2px 8px 1px',
              fontFamily: 'var(--cth-font-display)',
              fontSize: 8,
              lineHeight: '14px',
              textTransform: 'uppercase',
              color: connected ? 'var(--cth-mint-700, #1f7a4d)' : 'var(--cth-ink-500)',
              background: connected ? 'var(--cth-lemon)' : 'var(--cth-cream-200)',
              boxShadow: `inset 0 0 0 1px ${connected ? 'var(--cth-mint-700, #1f7a4d)' : 'var(--cth-ink-300)'}`
            }}
          >
            {connected ? t('browserDesktop.connected') : t('browserDesktop.disconnected')}
          </span>
          <span style={{ fontSize: 12, color: 'var(--cth-ink-500)' }}>
            {bridgeStatus?.listening ? t('browserDesktop.listening') : t('browserDesktop.notListening')}
            {' · '}
            {t('browserDesktop.port')}: <code style={{ fontFamily: 'var(--cth-font-mono)' }}>{port}</code>
          </span>
        </div>

        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
            padding: '8px 10px',
            background: 'var(--cth-paper-100)',
            boxShadow: 'inset 0 0 0 1px var(--cth-ink-300)'
          }}
        >
          <span style={{ ...labelStyle, marginBottom: 0 }}>{t('browserDesktop.token')}</span>
          <code
            style={{
              fontFamily: 'var(--cth-font-mono)',
              fontSize: 11,
              lineHeight: '16px',
              color: 'var(--cth-ink-900)',
              wordBreak: 'break-all'
            }}
          >
            {token || '…'}
          </code>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <PixelButton variant="secondary" size="sm" onClick={() => { void copyToken(); }} disabled={!token}>
              {t('browserDesktop.copyToken')}
            </PixelButton>
            <PixelButton variant="secondary" size="sm" onClick={() => { void regenerate(); }} disabled={busy}>
              {t('browserDesktop.regenerateToken')}
            </PixelButton>
          </div>
        </div>

        <div style={{ fontSize: 12, lineHeight: '16px', color: 'var(--cth-ink-500)' }}>
          {t('browserDesktop.extensionPath')}:{' '}
          <code style={{ fontFamily: 'var(--cth-font-mono)', fontSize: 11 }}>
            {t('browserDesktop.extensionPathHint')}
          </code>
        </div>
      </div>

      {/* Desktop permissions */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
          <span style={labelStyle}>{t('browserDesktop.desktopTitle')}</span>
          <span style={{ fontSize: 11, lineHeight: '15px', color: 'var(--cth-ink-400, var(--cth-ink-500))' }}>
            {t('browserDesktop.desktopDesc')}
          </span>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <PermissionRow
            label={t('browserDesktop.accessibility')}
            granted={permissions?.accessibility === true}
            openLabel={t('browserDesktop.openAccessibilitySettings')}
            onOpen={() => { void window.cth.desktopControlOpenAccessibilitySettings(); }}
          />
          <PermissionRow
            label={t('browserDesktop.screenCapture')}
            granted={permissions?.screenCapture === true}
            openLabel={t('browserDesktop.openScreenCaptureSettings')}
            onOpen={() => { void window.cth.desktopControlOpenScreenCaptureSettings(); }}
          />
        </div>
      </div>

      {note && (
        <span style={{ fontSize: 12, color: 'var(--cth-mint)' }}>{note}</span>
      )}
    </div>
  );
}

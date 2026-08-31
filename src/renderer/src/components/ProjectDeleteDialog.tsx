import { useTranslation } from 'react-i18next';
import { PixelPanel } from './PixelPanel';
import { PixelButton } from './PixelButton';
import { useStore } from '@/store/store';

export interface ProjectDeleteDialogProps {
  projectId: string;
  onClose: () => void;
  onConfirm: (projectId: string) => void;
}

export function ProjectDeleteDialog({ projectId, onClose, onConfirm }: ProjectDeleteDialogProps) {
  const { t } = useTranslation();
  const project = useStore((s) => s.projects.find((p) => p.projectId === projectId));
  const name = project?.name ?? t('projects.thisProject');

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 80,
      background: 'rgba(26, 25, 30, 0.45)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: 24
    }}>
      <div style={{ width: 420, maxWidth: '94vw' }}>
        <PixelPanel variant="dialog" title={t('projects.deleteTitle')} noPadding>
          <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
            <p style={{ margin: 0, fontSize: 13, lineHeight: '20px', color: 'var(--cth-ink-700)' }}>
              {t('projects.deleteBody', { name })}
            </p>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <PixelButton onClick={onClose}>{t('common.cancel')}</PixelButton>
              <PixelButton variant="destructive" onClick={() => onConfirm(projectId)}>
                {t('common.delete')}
              </PixelButton>
            </div>
          </div>
        </PixelPanel>
      </div>
    </div>
  );
}

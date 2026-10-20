import { useEffect, useRef, type ReactNode } from 'react';
import { Icon } from './icons';

interface Props {
  title: string;
  /** A short line under the title. */
  subtitle?: ReactNode;
  /** Narrower box, for a confirmation. */
  small?: boolean;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
}

/**
 * A modal window on the browser's own <dialog>, which traps focus, closes on Escape
 * and returns focus to the button that opened it.
 */
export function Modal({ title, subtitle, small = false, onClose, children, footer }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = `${title.replace(/\W+/g, '-')}-title`;
  // Set when this component removes the window itself, so that is not mistaken for the user closing it.
  const unmounting = useRef(false);

  useEffect(() => {
    const dialog = ref.current;
    unmounting.current = false;
    if (dialog && !dialog.open) dialog.showModal();
    return () => {
      unmounting.current = true;
      dialog?.close();
    };
  }, []);

  return (
    <dialog
      ref={ref}
      className={small ? 'modal modal-small' : 'modal'}
      aria-labelledby={titleId}
      onClose={() => {
        // A window opened again (as in development's double mount) is not one the user closed.
        if (!unmounting.current && ref.current?.open !== true) onClose();
      }}
      onClick={(event) => {
        // A click on the backdrop lands on the dialog itself, not on its contents.
        if (event.target === ref.current) onClose();
      }}
    >
      <div className="modal-head">
        <div>
          <h2 id={titleId}>{title}</h2>
          {subtitle !== undefined && <p className="muted">{subtitle}</p>}
        </div>
        <button type="button" className="icon-button" aria-label="Close" onClick={onClose}>
          <Icon name="close" />
        </button>
      </div>
      <div className="modal-body">{children}</div>
      {footer !== undefined && <div className="modal-foot">{footer}</div>}
    </dialog>
  );
}

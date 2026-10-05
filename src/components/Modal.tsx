import type { ReactNode } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

/** Dialog with a title. Without onClose it cannot be dismissed: the user must pick one of its actions. */
export function Modal({
  title,
  description,
  onClose,
  children,
  wide,
}: {
  title?: string;
  description?: ReactNode;
  onClose?(): void;
  children: ReactNode;
  wide?: boolean;
}) {
  return (
    <Dialog open onOpenChange={(o) => !o && onClose?.()}>
      <DialogContent
        data-no-shortcuts=""
        showCloseButton={Boolean(onClose)}
        className={cn("max-h-[88vh] gap-3 overflow-y-auto p-5", wide ? "sm:max-w-3xl" : "sm:max-w-md")}
        onEscapeKeyDown={(e) => !onClose && e.preventDefault()}
        onInteractOutside={(e) => !onClose && e.preventDefault()}
        {...(description ? {} : { "aria-describedby": undefined })}
      >
        <DialogHeader>
          <DialogTitle className={cn("text-lg font-bold", !title && "sr-only")}>{title ?? "对话框"}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>
        {children}
      </DialogContent>
    </Dialog>
  );
}

/** Buttons row at the bottom of a dialog. */
export function ModalActions({ children }: { children: ReactNode }) {
  return <div className="mt-2 flex flex-wrap justify-end gap-2">{children}</div>;
}

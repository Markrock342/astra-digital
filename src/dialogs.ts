// One place for confirm / prompt. SweetAlert2 is bundled (no CDN). Callers never use Swal.fire.
import Swal from "sweetalert2";
import "sweetalert2/dist/sweetalert2.css";
import "./dialogs.css";

type ConfirmOptions = {
  title: string;
  text?: string;
  confirmText?: string;
  cancelText?: string;
  /** Red confirm button for deletes and other destructive steps. */
  danger?: boolean;
};

type PromptOptions = {
  title: string;
  label?: string;
  placeholder?: string;
  /** Empty or whitespace cannot be confirmed. */
  required?: boolean;
};

const base = {
  buttonsStyling: false,
  heightAuto: false,
  scrollbarPadding: false,
  focusConfirm: false,
  allowOutsideClick: true,
  allowEscapeKey: true,
  showCancelButton: true,
  cancelButtonText: "ยกเลิก",
  customClass: {
    container: "astra-dialog-root",
    popup: "astra-dialog",
    title: "astra-dialog-title",
    htmlContainer: "astra-dialog-text",
    actions: "astra-dialog-actions",
    input: "astra-dialog-input",
    validationMessage: "astra-dialog-error",
  },
};

export async function confirmDialog(options: ConfirmOptions): Promise<boolean> {
  const result = await Swal.fire({
    ...base,
    title: options.title,
    text: options.text,
    confirmButtonText: options.confirmText ?? "ยืนยัน",
    cancelButtonText: options.cancelText ?? "ยกเลิก",
    focusCancel: !!options.danger,
    customClass: {
      ...base.customClass,
      confirmButton: options.danger ? "astra-confirm is-danger" : "astra-confirm",
      cancelButton: "astra-cancel",
    },
  });
  return result.isConfirmed;
}

/** Resolves to the trimmed text, or null when cancelled, dismissed, or Esc. */
export async function promptDialog(options: PromptOptions): Promise<string | null> {
  const result = await Swal.fire({
    ...base,
    title: options.title,
    input: "text",
    inputLabel: options.label,
    inputPlaceholder: options.placeholder,
    confirmButtonText: "ยืนยัน",
    inputValidator: (value) => {
      if (options.required && !value.trim()) return "กรอกข้อมูลก่อน";
      return null;
    },
    customClass: {
      ...base.customClass,
      confirmButton: "astra-confirm",
      cancelButton: "astra-cancel",
    },
  });
  if (!result.isConfirmed) return null;
  const text = String(result.value ?? "").trim();
  return text || null;
}

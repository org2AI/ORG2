import Modal from "@src/scaffold/ModalSystem";

import WikiBrowser from "./WikiBrowser";

export default function WikiModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  return (
    <Modal
      visible={open}
      onCancel={onClose}
      title="ORG2 Wiki"
      footer={null}
      width={1040}
      className="h-[80dvh]"
      bodyClassName="flex min-h-0 flex-col overflow-hidden! p-0"
    >
      {open && <WikiBrowser />}
    </Modal>
  );
}

import React from "react";
import { useTranslation } from "react-i18next";

import type { LinearTeamSummary } from "@src/api/http/integrations";
import Button from "@src/components/Button";
import Input from "@src/components/Input";
import Select from "@src/components/Select";
import Textarea from "@src/components/Textarea";
import { FloppyDiskIcon, HugeiconsIcon } from "@src/icons";

import type { ProjectDraft } from "./types";

interface ProjectFormProps {
  draft: ProjectDraft;
  teams: LinearTeamSummary[];
  saving: boolean;
  submitLabel: string;
  hideTeamSelect?: boolean;
  onDraftChange: (draft: ProjectDraft) => void;
  onSubmit: () => void;
  onCancel: () => void;
}

export const ProjectForm: React.FC<ProjectFormProps> = ({
  draft,
  teams,
  saving,
  submitLabel,
  hideTeamSelect = false,
  onDraftChange,
  onSubmit,
  onCancel,
}) => {
  const { t } = useTranslation(["projects", "common"]);
  return (
    <div className="mt-4 space-y-3">
      <Input
        size="large"
        className="w-full"
        value={draft.name}
        onChange={(_value, event) =>
          onDraftChange({ ...draft, name: event.target.value })
        }
        placeholder={t("linearProjects.forms.projectName")}
      />
      <Textarea
        value={draft.description}
        onChange={(value) => onDraftChange({ ...draft, description: value })}
        placeholder={t("linearProjects.forms.description")}
        autoSize={{ minRows: 4 }}
        className="w-full"
      />
      {!hideTeamSelect && (
        <Select
          value={draft.teamId}
          options={teams.map((team) => ({
            value: team.id,
            label: `${team.name} (${team.key})`,
          }))}
          onChange={(value) =>
            onDraftChange({ ...draft, teamId: value as string })
          }
          className="w-full"
          dropdownWidthMode="match"
        />
      )}
      <div className="flex justify-end gap-2">
        <Button size="small" variant="tertiary" onClick={onCancel}>
          {t("common:actions.cancel")}
        </Button>
        <Button
          size="small"
          variant="primary"
          icon={
            <HugeiconsIcon icon={FloppyDiskIcon} data-icon="save" size={14} />
          }
          loading={saving}
          disabled={!draft.name.trim() || (!hideTeamSelect && !draft.teamId)}
          onClick={onSubmit}
        >
          {submitLabel}
        </Button>
      </div>
    </div>
  );
};

import { useState } from "react";
import { KeyRound, Plus, Trash2 } from "lucide-react";
import { Button, Card, Input, Table } from "@getloopscale/ui";
import { ConfirmDialog } from "@/components/dialogs/confirm-dialog";
import { AppModal } from "@/components/ui/app-modal";
import { PageShell } from "@/components/ui/page-shell";
import { usePageMeta } from "@/hooks/use-page-meta";
import { useRequireAuth } from "@/hooks/use-auth";
import {
  useDeleteSandboxSecret,
  useSandboxSecrets,
  useSaveSandboxSecret,
} from "@/hooks/sandboxes/use-sandboxes";
import { formatDate } from "@/lib/formatting/format";
import { estadoDaLista } from "@/lib/list-state";
import { sandboxFailure } from "./sandbox-labels";
import { SandboxSections } from "./sandbox-sections";

/** What the API accepts as the name of a secret: the name of an environment variable. */
const SECRET_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * The secrets a sandbox can receive as environment variables. A value is
 * written here and never read back: the API has no route that returns it.
 */
export function SandboxSecretsPage() {
  useRequireAuth();
  const { setPageTitle } = usePageMeta();
  const secretsQuery = useSandboxSecrets();
  const secrets = secretsQuery.data?.secrets ?? [];
  const save = useSaveSandboxSecret();
  const remove = useDeleteSandboxSecret();
  const [editing, setEditing] = useState<{
    name: string;
    replace: boolean;
  } | null>(null);
  const [name, setName] = useState("");
  const [value, setValue] = useState("");
  const [removeTarget, setRemoveTarget] = useState<string | null>(null);

  const edit = (target: { name: string; replace: boolean }) => {
    save.reset();
    setName(target.name);
    setValue("");
    setEditing(target);
  };
  const close = () => {
    setEditing(null);
    setValue("");
  };
  const nameIsValid = SECRET_NAME.test(name);
  const submit = () => save.mutate({ name, value }, { onSuccess: close });

  return (
    <>
      <PageShell
        title="Sandbox secrets"
        description={<SandboxSections />}
        onTitleChange={setPageTitle}
        loading={secretsQuery.isLoading}
        primaryAction={{
          label: "New secret",
          icon: Plus,
          onClick: () => edit({ name: "", replace: false }),
        }}
        empty={estadoDaLista(
          {
            failure: secretsQuery.isError,
            empty:
              !secretsQuery.isLoading && secrets.length === 0
                ? {
                    icon: KeyRound,
                    title: "No secrets yet",
                    description:
                      'A secret reaches a sandbox as an environment variable when the sandbox is created with its name, as in Sandbox.create({ secrets: ["API_TOKEN"] }).',
                  }
                : undefined,
          },
          "secrets",
        )}
      >
        <Card>
          <Card.Body className="p-0">
            <Table>
              <Table.Header>
                <Table.Row>
                  <Table.HeaderCell>Name</Table.HeaderCell>
                  <Table.HeaderCell>Created</Table.HeaderCell>
                  <Table.HeaderCell>Value last changed</Table.HeaderCell>
                  <Table.HeaderCell align="right">
                    <span className="sr-only">Actions</span>
                  </Table.HeaderCell>
                </Table.Row>
              </Table.Header>
              <Table.Body>
                {secrets.map((secret) => (
                  <Table.Row key={secret.name}>
                    <Table.Cell>
                      <span className="font-mono text-label text-foreground">
                        {secret.name}
                      </span>
                    </Table.Cell>
                    <Table.Cell>
                      <span className="text-label text-muted-foreground">
                        {formatDate(secret.created_at, "datetime")}
                      </span>
                    </Table.Cell>
                    <Table.Cell>
                      <span className="text-label text-muted-foreground">
                        {formatDate(secret.updated_at, "datetime")}
                      </span>
                    </Table.Cell>
                    <Table.Cell align="right">
                      <span className="inline-flex gap-2">
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() =>
                            edit({ name: secret.name, replace: true })
                          }
                        >
                          Replace value
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          aria-label={`Delete secret ${secret.name}`}
                          onClick={() => setRemoveTarget(secret.name)}
                        >
                          <Trash2 className="size-4" aria-hidden="true" />
                        </Button>
                      </span>
                    </Table.Cell>
                  </Table.Row>
                ))}
              </Table.Body>
            </Table>
          </Card.Body>
        </Card>
      </PageShell>
      <AppModal
        open={editing !== null}
        onClose={close}
        title={
          editing?.replace
            ? `Replace the value of ${editing.name}`
            : "New secret"
        }
        description="The value is stored encrypted and cannot be read back. A running sandbox reads a new value on its next command."
        busy={save.isPending}
        footer={
          <>
            <Button variant="secondary" onClick={close}>
              Cancel
            </Button>
            <Button
              onClick={submit}
              disabled={save.isPending || !nameIsValid || value === ""}
            >
              Save secret
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          {!editing?.replace && (
            <label className="block space-y-1">
              <span className="text-label text-foreground">Name</span>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="API_TOKEN"
                autoComplete="off"
              />
              {name !== "" && !nameIsValid && (
                <span className="block text-label text-destructive">
                  Use letters, digits and underscores, and do not start with a
                  digit.
                </span>
              )}
            </label>
          )}
          <label className="block space-y-1">
            <span className="text-label text-foreground">Value</span>
            <Input
              type="password"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              autoComplete="new-password"
            />
          </label>
          {save.isError && (
            <p role="alert" className="text-body-sm text-destructive">
              {sandboxFailure(save.error)}
            </p>
          )}
        </div>
      </AppModal>

      <ConfirmDialog
        open={removeTarget !== null}
        onOpenChange={(next) => !next && setRemoveTarget(null)}
        title="Delete secret"
        description={`Sandboxes created with ${removeTarget ?? ""} stop running commands until they are recreated without it.`}
        confirmLabel="Delete secret"
        intent="destructive"
        loading={remove.isPending}
        onConfirm={async () => {
          if (removeTarget) await remove.mutateAsync(removeTarget);
          setRemoveTarget(null);
        }}
      />
    </>
  );
}

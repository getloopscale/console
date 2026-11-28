import { Badge, Card, Table } from '@getloopscale/ui';
import { PageShell } from '@/components/ui/page-shell';
import { usePageMeta } from '@/hooks/use-page-meta';
import { useRequireAuth } from '@/hooks/use-auth';
import { useSandboxTemplates } from '@/hooks/sandboxes/use-sandboxes';
import { sandboxFailure } from './sandbox-labels';
import { SandboxSections } from './sandbox-sections';

/** The images a sandbox can start from, each with the call that starts one. */
export function SandboxTemplatesPage() {
  useRequireAuth();
  const { setPageTitle } = usePageMeta();
  const templatesQuery = useSandboxTemplates();
  const templates = templatesQuery.data?.templates ?? [];

  return (
    <PageShell
      title="Sandbox templates"
      description={<SandboxSections />}
      onTitleChange={setPageTitle}
      loading={templatesQuery.isLoading}
    >
      {templatesQuery.isError ? (
        <p role="alert" className="text-body-sm text-destructive">
          Could not read the templates: {sandboxFailure(templatesQuery.error)}
        </p>
      ) : (
        <Card>
          <Card.Body className="p-0">
            <Table>
              <Table.Header>
                <Table.Row>
                  <Table.HeaderCell>Name</Table.HeaderCell>
                  <Table.HeaderCell>Image</Table.HeaderCell>
                  <Table.HeaderCell>Source</Table.HeaderCell>
                  <Table.HeaderCell>Start a sandbox from it</Table.HeaderCell>
                </Table.Row>
              </Table.Header>
              <Table.Body>
                {templates.map((template) => (
                  <Table.Row key={template.id ?? `builtin:${template.name}`}>
                    <Table.Cell>
                      <span className="font-mono text-label text-foreground">{template.name}</span>
                      {template.description && (
                        <p className="text-label text-muted-foreground">{template.description}</p>
                      )}
                    </Table.Cell>
                    <Table.Cell>
                      <span className="font-mono text-label break-all text-muted-foreground">{template.image}</span>
                    </Table.Cell>
                    <Table.Cell>
                      <Badge variant={template.builtin ? 'default' : 'success'}>
                        {template.builtin ? 'Built-in' : 'Registered'}
                      </Badge>
                    </Table.Cell>
                    <Table.Cell>
                      <code className="font-mono text-label text-muted-foreground">
                        {`Sandbox.create('${template.name}')`}
                      </code>
                    </Table.Cell>
                  </Table.Row>
                ))}
              </Table.Body>
            </Table>
          </Card.Body>
        </Card>
      )}
    </PageShell>
  );
}

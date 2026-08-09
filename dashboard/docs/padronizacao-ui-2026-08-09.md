# Padronização de componentes, menus e modais — dashboard

> Medido em 2026-08-09 contra `theo-cloud/dashboard` no estado de `develop`.
> Todo número aqui vem de um comando executado, não de leitura por amostragem.
> Onde a medição **não** encontrou problema, o documento diz isso — um relatório que só
> lista defeitos não permite saber o que já está certo.

## Sumário executivo

O dashboard tem **423 arquivos `.tsx`**, dos quais 123 são páginas, 70 são componentes
locais de página e 19 são componentes compartilhados.

A conclusão que a medição sustenta é mais estreita — e mais acionável — do que "falta
padronização":

| | Estado medido |
|---|---|
| Navegação | **já é dado declarativo**, e nenhum link aponta para rota inexistente |
| Confirmação destrutiva | **91% já usa o componente compartilhado** (29 de 32) |
| Duplicação de componentes locais | **1 caso** em 70 arquivos |
| **Modais** | **4 portas de entrada concorrentes** para o mesmo primitivo — este é o problema real |

O trabalho de padronização que a evidência justifica é **um só**: consolidar a camada de
modal. Os demais eixos estão em estado melhor do que a percepção sugere, e mexer neles
agora seria trabalho sem defeito correspondente.

---

## 1. Modais — o problema real

### 1.1 Quatro portas para a mesma coisa

67 arquivos renderizam um modal. Eles entram por quatro caminhos diferentes:

| Porta | Arquivos | O que é |
|---|---:|---|
| `components/dialogs/*` | 33 | 4 modais prontos (confirm, new-folder, plan-limit-upgrade, redeploy) |
| `components/ui/dialog` | 17 | primitivo compound (`Dialog.Root/Overlay/Content`) |
| `components/ui/app-modal` | 13 | primitivo declarativo (`<AppModal size=… />`) |
| `@radix-ui/react-dialog` direto | 2 | fura os dois primitivos |

Comandos:

```bash
cd dashboard/src
grep -rl 'Dialog\|Modal' . | grep '\.tsx$' | grep -v test | wc -l        # 67
for p in "ui/app-modal" "ui/dialog" "@radix-ui/react-dialog" "components/dialogs/"; do
  echo "$p: $(grep -rl "$p" . | grep '\.tsx$' | grep -v test | wc -l)"
done
```

### 1.2 Os dois primitivos são quase o mesmo arquivo

`components/ui/dialog.tsx` (97 LoC) e `components/ui/app-modal.tsx` (104 LoC) são **ambos**
construídos direto sobre `@radix-ui/react-dialog`. O overlay é **idêntico byte a byte** nos
dois:

```
className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm animate-fade-in"
```

Isto não é divergência de design com duas intenções diferentes. É duplicação.

> **Correção de uma hipótese que eu tinha.** Presumi que `ui/dialog` fosse re-export do
> design system `@usetheo/ui` e sofresse o bug de `Sheet` descrito no doc-comment de
> `app-modal`. Abri o arquivo: não é. Os dois são wrappers locais do mesmo Radix, e o bug
> do `@usetheo/ui` **não** os afeta. A recomendação abaixo mudou por causa disso.

### 1.3 O padrão já está declarado — e é violado pelos próprios componentes compartilhados

`components/ui/app-modal.tsx:6-19` declara, no código:

> *"AppModal — the **system-wide standardized modal primitive**. […] Use this instead of
> `<Dialog.Content>` for **every** transient action screen — it is the traditional-modal
> pattern for the whole dashboard."*

E entrega o que um padrão precisa entregar: uma escala única de largura.

```
/** Size token → max-width. One width scale instead of an ad-hoc `max-w-*` per call site. */
sm: 'max-w-md' · md: 'max-w-lg' · lg: 'max-w-2xl' · xl: …
```

`ui/dialog` aceita `className` livre — cada call site decide sua largura.

**Os três modais compartilhados violam o padrão declarado**, usando `ui/dialog`:

- `components/dialogs/confirm-dialog.tsx`
- `components/dialogs/redeploy-dialog.tsx`
- `components/dialogs/plan-limit-upgrade-modal.tsx`

Isso importa mais que os 17 call sites de página: são os componentes que o resto do produto
copia como referência. Enquanto eles usarem a porta errada, a porta errada é o exemplo.

### 1.4 O custo hoje é pequeno, e é isso que torna a hora certa

Larguras ad-hoc nos call sites de `ui/dialog` / Radix:

| Largura | Ocorrências |
|---|---:|
| `max-w-md` | 2 |
| `max-w-lg` | 2 |
| `max-w-2xl` | 2 |
| `max-w-sm` | 1 |
| `max-w-4xl` | 1 |

**5 valores distintos, 8 ocorrências, 1 (`max-w-4xl`) fora da escala de 4 tokens.**

A deriva visual ainda é pequena. Consolidar agora custa uma migração de 19 call sites;
consolidar quando forem 60 custa uma migração de 60 e uma revisão visual de cada tela.

---

## 2. O que medi e **não** encontrou problema

Esta seção existe para que ninguém gaste esforço onde não há defeito.

### 2.1 A navegação já é dado declarativo — e está íntegra

`components/layout/app-sidebar-menus.ts` (474 LoC) declara a navegação como estrutura
tipada — `MenuItem` (`:51`), `MenuGroup` (`:76`), `MenuDefinition` (`:84`) — e
`app-sidebar.tsx` apenas a renderiza. Isso é o desenho correto; não precisa mudar.

**Nenhum item de menu aponta para rota inexistente.** Verificado contra as 109 rotas
declaradas nos 12 arquivos que contêm `<Route`:

```bash
grep -rhoE 'path="[^"]+"' $(grep -rl "<Route" . | grep '\.tsx$' | grep -v test) \
  | sed 's/path="//;s/"//' | sort -u > /tmp/all-routes.txt     # 109 rotas
# 57 rotas no menu, 0 sem correspondência após normalizar placeholders
```

> **Segunda correção de hipótese.** A primeira comparação acusou 19 links quebrados. Eram
> falsos positivos em duas camadas: eu varrera só 4 arquivos de rota em vez de 12, e o
> menu escreve `{project}` onde o router escreve `:name`. Depois de corrigir as duas
> coisas, o número é **zero**. Um documento que tivesse parado na primeira medição teria
> mandado o time caçar 19 defeitos inexistentes.

### 2.2 Confirmação destrutiva já é majoritariamente padronizada

- **29 arquivos** usam `components/dialogs/confirm-dialog`
- **3** têm diálogo próprio, e nenhum deles importa o compartilhado:
  - `pages/projects/components/bulk-delete-projects-dialog.tsx`
  - `pages/infra/components/delete-environment-dialog.tsx`
  - `pages/infra/components/delete-secret-dialog.tsx`

91% de adesão. Os 3 casos merecem uma olhada individual — todos parecem ter razão de UX
(exclusão em massa, confirmação por digitação do nome) —, mas **não** justificam um esforço
de padronização próprio.

Comando:

```bash
for f in $(find . \( -name '*delete*dialog*.tsx' -o -name '*confirm*.tsx' \) \
           -not -name '*.test.tsx' | grep -v 'dialogs/confirm-dialog'); do
  grep -q "dialogs/confirm-dialog" "$f" || echo "$f"
done                                                    # 3 próprios
grep -rl 'dialogs/confirm-dialog' . | grep '\.tsx$' | grep -v test | wc -l   # 29
```

### 2.3 Componentes locais praticamente não duplicam

Em 70 componentes locais de página, **um único** nome se repete:
`overview-kpi-strip.tsx`, em dois lugares. Um caso não é um padrão.

---

## 3. Divergência menor, com custo real de leitura

O menu identifica o projeto como `{project}`; o router, como `:name`:

```
menu:   /projects/{project}/deployments      (app-sidebar-menus.ts)
router: /projects/:name/deployments          (routes/*.tsx)
```

Não quebra nada — o `{project}` é substituído em runtime. Mas foi exatamente o que me fez
reportar 9 links quebrados que não existiam, e fará o mesmo com a próxima pessoa que
comparar as duas listas. É uma renomeação de um parâmetro em dois arquivos.

---

## 4. O que fazer — em ordem, com critério de pronto

### P1 — Fazer os componentes compartilhados obedecerem ao padrão que o código declara

Migrar `confirm-dialog`, `redeploy-dialog` e `plan-limit-upgrade-modal` de `ui/dialog` para
`ui/app-modal`, escolhendo o token de tamanho equivalente à largura atual.

Primeiro porque são a referência que o resto copia, e porque são 3 arquivos com 33
consumidores que **não** mudam.

**Pronto quando:** `grep -rl 'ui/dialog' components/dialogs/` retorna vazio, e as três telas
abrem visualmente idênticas ao estado atual (largura equivalente, overlay já é o mesmo).

### P2 — Fechar as duas fugas para o Radix

2 arquivos importam `@radix-ui/react-dialog` direto, contornando os dois primitivos. Ou
passam a usar `AppModal`, ou o motivo de não poderem vai no código como comentário.

**Pronto quando:** `grep -rl '@radix-ui/react-dialog' --exclude-dir=ui` retorna vazio, ou
cada ocorrência restante tem uma linha explicando o porquê.

### P3 — Migrar os 17 call sites de página e remover `ui/dialog`

Só depois de P1: enquanto os compartilhados usarem a porta antiga, migrar as páginas é
pedir a elas o que o próprio design system não faz.

Ao migrar, `max-w-4xl` precisa de decisão: ou vira um token `2xl` na escala, ou aquela tela
adota `xl`. **Não** deixar como `className` avulso — é assim que a escala volta a vazar.

**Pronto quando:** `components/ui/dialog.tsx` é deletado e a suíte passa. Deletar é o teste:
enquanto o arquivo existir, alguém o importa de novo.

### P4 — Unificar o nome do parâmetro de projeto

`{project}` no menu ou `:name` no router — tanto faz qual vence, desde que seja um só.

**Pronto quando:** a comparação de `sed 's/{\(.*\)}/:\1/'` entre menu e rotas não precisa da
substituição para casar.

### Fora de escopo, deliberadamente

- **Reorganizar `pages/` vs `components/`** — 123 páginas com 70 componentes locais é
  colocation, não desorganização. Não medi defeito que justifique mexer.
- **Padronizar os 3 diálogos de exclusão próprios** — 91% de adesão já é alto e cada
  exceção parece ter razão de UX. Vale uma revisão caso a caso, não um esforço.
- **Storybook** — só 2 stories existem. Expandir é trabalho de valor, mas é outra
  discussão, não padronização.

---

## 5. Limites deste documento

O que **não** foi medido, e portanto não é afirmado:

- **Aparência renderizada.** Comparei classes CSS e estrutura de código, não pixels. Duas
  telas podem usar o mesmo primitivo e ainda assim divergir em espaçamento interno.
- **Fluxo percebido pelo usuário.** Não percorri as jornadas no navegador. Afirmações sobre
  "o fluxo X é inconsistente" exigiriam isso, e não estão aqui.
- **Acessibilidade.** Ambos os primitivos delegam foco/ESC/ARIA ao Radix, o que é o caminho
  certo, mas não auditei foco visível, ordem de tabulação nem leitor de tela.
- **Os 3 diálogos de exclusão próprios** foram contados e classificados pelo import,
  não lidos um a um. A razão de UX que atribuo a cada um é inferida do nome do arquivo.

Cada um desses seria uma medição própria. Nenhum precisa ser feito antes de P1–P4, que se
sustentam só na evidência acima.

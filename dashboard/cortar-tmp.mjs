import ts from 'typescript';
import { readFileSync, writeFileSync } from 'node:fs';
const F = 'src/pages/promptly/detail.tsx';
const src = readFileSync(F, 'utf8');
const L = src.split('\n');
const sf = ts.createSourceFile('d.tsx', src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const nome = (n) => (n.kind === ts.SyntaxKind.JsxElement ? n.openingElement.tagName : n.tagName)?.getText(sf);
let shell = null;
const acha = (n) => { if (ts.isJsxElement(n) && nome(n) === 'PageShell') shell = n; ts.forEachChild(n, acha); };
acha(sf);

const CARDS = {
  'Texto do prompt': { arq: 'texto-card', comp: 'TextoDoPromptCard' },
  'Tags':            { arq: 'tags-card',  comp: 'TagsCard' },
  'Discussão':       { arq: 'discussao-card', comp: 'DiscussaoCard' },
  'Ambientes':       { arq: 'ambientes-card', comp: 'AmbientesCard' },
  'Revisões':        { arq: 'revisoes-card',  comp: 'RevisoesCard' },
};
const achados = [];
for (const c of shell.children) {
  if (!ts.isJsxElement(c) && !ts.isJsxExpression(c)) continue;
  const t = c.getText(sf);
  const h2 = (t.match(/<h2>([^<{]{2,40})/) || [])[1]?.trim();
  if (!h2 || !CARDS[h2]) continue;
  // acha o <Card> mais externo dentro do bloco
  let card = null;
  const buscaCard = (n) => { if (!card && ts.isJsxElement(n) && nome(n) === 'Card') card = n; ts.forEachChild(n, buscaCard); };
  buscaCard(c);
  const guardado = ts.isJsxExpression(c);
  achados.push({
    h2, ...CARDS[h2], guardado,
    blocoA: sf.getLineAndCharacterOfPosition(c.getStart(sf)).line,
    blocoB: sf.getLineAndCharacterOfPosition(c.getEnd()).line,
    cardA: sf.getLineAndCharacterOfPosition(card.getStart(sf)).line,
    cardB: sf.getLineAndCharacterOfPosition(card.getEnd()).line,
    guardaTexto: guardado ? t.slice(0, t.indexOf('<Card')) : '',
  });
}
writeFileSync('/tmp/achados.json', JSON.stringify(achados, null, 1));
for (const x of achados) console.log(`${x.h2.padEnd(18)} bloco ${x.blocoA+1}-${x.blocoB+1} | card ${x.cardA+1}-${x.cardB+1} | guardado=${x.guardado}`);

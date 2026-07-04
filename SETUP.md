# C_TS452 Study — setup do zero

Tudo direto no remoto, sem `wrangler dev` local (evita o problema do localhost/IPv6 e do banco local sem schema).

## 1. Preparar a pasta

```bash
# renomeia o projeto antigo pra não conflitar
mv ~/c-ts452-study ~/c-ts452-study-old 2>/dev/null

# descompacta o zip novo
unzip ~/Downloads/c-ts452-study.zip -d ~/
cd ~/c-ts452-study
```

## 2. Criar o banco novo

```bash
npx wrangler d1 create c-ts452-db-v2
```

Copia o `database_id` que aparecer e cola no `wrangler.toml` (no lugar do placeholder).

## 3. Schema + seed (direto no remoto)

```bash
npx wrangler d1 execute c-ts452-db-v2 --remote --file=./schema.sql
npx wrangler d1 execute c-ts452-db-v2 --remote --file=./seed.sql
```

Conferir:

```bash
npx wrangler d1 execute c-ts452-db-v2 --remote \
  --command="SELECT area, COUNT(*) qtd FROM concepts GROUP BY area"
```

Deve voltar 8 áreas somando 50 conceitos.

## 4. Chave da API Anthropic (examinador IA)

```bash
npx wrangler secret put ANTHROPIC_API_KEY
```

Cola a chave quando pedir (pega em console.anthropic.com → API Keys).

## 5. Deploy

```bash
npx wrangler deploy
```

Vai devolver a URL (algo como `c-ts452-study.taveiraallan.workers.dev`).
Abre no navegador: o cockpit já carrega a fila com os 50 conceitos.

## 6. Teste rápido do backend (opcional)

```bash
curl -X POST https://SUA-URL.workers.dev/api/review \
  -H "Content-Type: application/json" \
  -d '{"concept_id": 1, "rating": 3}'
```

Se voltar JSON com `stability` e `due`, o FSRS tá vivo.

## Fluxo de uso

1. Abre a URL → fila do dia carrega (vencidos primeiro, depois novos)
2. **Gerar cenário** → a IA cria um caso novo (nunca repete os 3 últimos)
3. Escreve teu raciocínio → **Avaliar resposta** → a IA julga o raciocínio, não palavra-chave
4. O trilho anima: acertou = documento viaja até o fim; errou = para na etapa crítica e o resto apaga em cascata
5. Escolhe o rating (o sugerido pela IA vem destacado) → FSRS recalcula e agenda
6. **Mostrar regra** = recall barato sem gastar API
7. Rodapé: **o que eu mais erro** = erros por área e piores conceitos

## Custo

Cada cenário + avaliação ≈ 2 chamadas curtas ao Sonnet. Usa "Mostrar regra"
pros conceitos que já estão sólidos e guarda a IA pros que doem.

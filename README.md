<div align="center">
  <img width="1200" height="475" alt="GHBanner" src="https://ai.google.dev/static/site-assets/images/share-ais-513315318.png" />
</div>

# 🚀 WahaSender - Disparador de Mensagens WhatsApp

WahaSender é um painel completo para envio de mensagens em massa via WhatsApp utilizando a API do WAHA, com suporte a rodízio de sessões, simulação de digitação humana (typing status), intervalos inteligentes, janelas de horários e diretório unificado de contatos.

---

## ⚙️ Arquitetura e Recursos Recentes

### 🗄️ 1. Persistência Relacional (SQLite & PostgreSQL)
O sistema migrou do armazenamento em arquivo JSON simples para banco de dados relacional robusto controlado via **Knex.js** (com migrations baseadas em código):
* **SQLite (Padrão local)**: Armazenado fisicamente na pasta de persistência `./storage/database.sqlite`.
* **PostgreSQL**: Pronto para produção bastando alterar as chaves do banco de dados no arquivo `.env`.
* **Migração Automática de Dados**: Ao iniciar pela primeira vez com a nova arquitetura, o servidor detecta o arquivo `data.json` antigo e importa de forma totalmente transparente os seus contatos, grupos, campanhas, logs e fila transacional para a base relacional, gerando em seguida um backup (`data.json.bak`).

### 📦 2. Storage Provider Flexível (Upload de Mídias)
Uma camada de abstração de Storage foi adicionada ao backend para uploads de arquivos/mídias das suas campanhas:
* **Driver `local` (Filesystem)**: Salva as mídias em `./storage/uploads/` e as disponibiliza estaticamente via Express na rota `/uploads/`.
* **Driver `s3` (AWS S3 ou compatíveis)**: Envia diretamente para o **AWS S3**, **MinIO**, **Cloudflare R2** ou similares configurados via variáveis de ambiente.

### 🐳 3. Preparado para Docker & Volumes
Todo dado persistente do projeto (banco SQLite e uploads locais) está centralizado no diretório raiz `/storage`.
* Para rodar em containers Docker, você só precisa criar um volume apontando para a pasta física `/storage` para reter todas as informações e uploads de forma definitiva!
  ```bash
  # Exemplo de mapeamento de volume
  -v ./storage:/app/storage
  ```

### 📋 4. Importador Inteligente de Contatos
* **Download de Modelo**: Botão nas páginas de contatos e grupos para baixar um layout de exemplo em planilha XLSX com a estrutura correta.
* **Modal de Mapeamento de Colunas**: Ao carregar um arquivo Excel ou CSV no Diretório de Contatos, você pode associar visualmente quais colunas do seu arquivo correspondem a **Nome** e **Telefone** (com suporte a auto-detecção inteligente e preview em tempo real das primeiras 3 linhas antes de confirmar).

---

## 🛠️ Como Rodar Localmente

### Pré-requisitos
* **Node.js** (v18 ou superior recomendado)
* **WAHA API** instalada e rodando (ou similar compatível)

### Passo a Passo

1. **Instalar Dependências**:
   ```bash
   npm install
   ```

2. **Configurar as Variáveis de Ambiente**:
   Crie um arquivo `.env` na raiz do projeto (use como base as variáveis criadas automaticamente ou o exemplo a seguir):
   ```env
   # Gemini AI API Key
   GEMINI_API_KEY="SUA_API_KEY_AQUI"
   
   # URL base do Painel
   APP_URL="http://localhost:3000"
   
   # --- BANCO DE DADOS ---
   # DB_CLIENT: 'sqlite3' ou 'pg' (PostgreSQL)
   DB_CLIENT="sqlite3"
   
   # Configurações para PostgreSQL (caso mude o DB_CLIENT para 'pg')
   DB_HOST="localhost"
   DB_PORT=5432
   DB_USER="postgres"
   DB_PASSWORD="password"
   DB_DATABASE="waha_sender"
   
   # --- STORAGE ---
   # STORAGE_TYPE: 'local' ou 's3'
   STORAGE_TYPE="local"
   
   # Configurações para S3 (caso mude o STORAGE_TYPE para 's3')
   AWS_ACCESS_KEY_ID="seu_access_key"
   AWS_SECRET_ACCESS_KEY="sua_secret_key"
   AWS_REGION="us-east-1"
   AWS_BUCKET="nome-do-seu-bucket"
   AWS_ENDPOINT="" # Opcional (para MinIO, Cloudflare R2, etc.)
   ```

3. **Iniciar em Ambiente de Desenvolvimento**:
   ```bash
   npm run dev
   ```
   *As migrations do banco relacional rodarão de forma totalmente automática no boot do Express!*

4. **Gerar Build de Produção**:
   ```bash
   npm run build
   ```

5. **Iniciar em Produção**:
   ```bash
   npm run start
   ```

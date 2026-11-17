# Configurar a sincronização (Firebase)

Feito **uma vez só**, no computador, em uns 10–15 minutos. É grátis (plano Spark), e não precisa de cartão de crédito.
Os nomes dos botões podem variar um pouco: se algo não bater, mande um print.

## 1. Criar o projeto
1. Entre em **console.firebase.google.com** com a sua conta Google.
2. **Criar um projeto** → nome: `desgaste-kart` → continuar.
3. O Google Analytics pode ser **desativado** (não é usado) → **Criar projeto**.

## 2. Ativar o login
1. No menu à esquerda: **Criação (Build) → Authentication → Vamos começar**.
2. Aba **Método de login**:
   - **Google** → ativar → escolha o seu e-mail como "e-mail de suporte" → **Salvar**.
   - **E-mail/senha** → ativar (só a primeira chave) → **Salvar**.
3. Aba **Configurações → Domínios autorizados → Adicionar domínio** → `farrasbr.github.io` → **Adicionar**.

## 3. Criar o banco de dados
1. Menu: **Criação (Build) → Firestore Database → Criar banco de dados**.
2. Local: **southamerica-east1 (São Paulo)**. *(Não dá para trocar depois.)*
3. Escolha **Iniciar no modo de produção** → **Criar**.
4. Abra a aba **Regras**, apague tudo o que estiver lá, cole o conteúdo do arquivo [`firestore.rules`](firestore.rules) e clique em **Publicar**.

## 4. Pegar a configuração do app
1. Clique na **engrenagem ⚙ → Configurações do projeto**.
2. Em **Seus apps**, clique no ícone **Web `</>`**.
3. Apelido: `desgaste-kart-web`. **Não** marque o Firebase Hosting. → **Registrar app**.
4. Vai aparecer um código com `const firebaseConfig = { apiKey: ..., authDomain: ..., ... }`.
   Copie esse bloco e cole no arquivo [`firebase-config.js`](firebase-config.js), no lugar de `null`
   (ou mande para o Claude colocar).
   > Esses valores **não são senha**: eles só dizem qual projeto usar. Quem protege os dados é o login + as regras do passo 3.

## 5. Usar
- No app: role até **Sincronização** → **Entrar com Google** → **Criar minha garagem**. Os dados deste aparelho vão para a nuvem.
- Nos outros aparelhos: **Entrar com Google** com a **mesma conta** → a garagem é encontrada sozinha.
- Para o seu pai: no seu app, **Convidar alguém** → envie o link (ou o código). Ele abre o link, entra com a conta dele
  (Google ou e-mail e senha) e toca em **Entrar na garagem**. Os dois passam a ver e editar os mesmos dados.

## Bom saber
- Sem internet tudo continua funcionando; as alterações são enviadas quando a conexão voltar.
- Se duas pessoas alterarem **o mesmo registro** ao mesmo tempo, vale a última alteração enviada.
- Continue exportando **backups (JSON)** de vez em quando: é a sua cópia de segurança fora da nuvem.
- **Substituir tudo** (importar backup) também substitui os dados da garagem para todo mundo.

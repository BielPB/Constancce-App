# Atualização Constancce 1.1.23 — Sync V3

## Ordem obrigatória

### 1. Supabase SQL Editor
Abra `SUPABASE_SYNC_V3_1_1_23.sql`, copie todo o conteúdo, cole em **SQL Editor → New query** e clique **Run**.

Esse SQL:
- cria `constancce_sync_state`;
- cria `constancce_sync_mutations`;
- cria a RPC atômica `constancce_apply_sync_patch()`;
- bloqueia acesso direto dessas tabelas para usuários comuns;
- não apaga `device_sync` nem `constancce_domain_sync`.

### 2. Publicar a Edge Function
No Mac, dentro da pasta 1.1.23:

```bash
npx supabase login
```

Depois:

```bash
npx supabase functions deploy domain-sync --project-ref opuirvfoxrqfkvbihfbs --use-api
```

Confirme em **Supabase → Edge Functions → domain-sync** que a atualização aparece como recente.

### 3. Publicar o frontend
Suba o projeto completo 1.1.23 para a Vercel.

### 4. Validar o banco
Execute `SUPABASE_SYNC_V3_VERIFY_1_1_23.sql` no SQL Editor.

Depois que pelo menos um dispositivo abrir a conta, `constancce_sync_state` deve ter uma linha para o usuário e `revision` deve aumentar a cada alteração confirmada.

## Teste obrigatório multi-dispositivo

1. Feche o Constancce em todos os dispositivos.
2. Abra a conta no celular e aguarde aparecer `Sincronizado` no Perfil.
3. Crie uma tarefa `TESTE MOBILE` com horário.
4. Vá ao Perfil. O status deve voltar a `Sincronizado` após o envio.
5. No SQL de verificação, a revision deve ter aumentado.
6. Abra a mesma conta no desktop. A tarefa deve chegar no bootstrap; com a tela já aberta, a janela máxima normal de pull é ~5 segundos.
7. Crie uma tarefa diferente no desktop.
8. Volte ao celular: as duas tarefas devem permanecer.
9. Exclua uma delas no celular e confirme no desktop que ela some sem apagar a outra.

## Se aparecer “Falha de sincronização”

1. Verifique **Edge Functions → domain-sync → Invocations**.
2. `POST 200` = mutação confirmada.
3. `POST 409` pode ocorrer temporariamente em edição concorrente; o cliente faz rebase e retry automaticamente.
4. `503 sync_v3_migration_required` = o SQL da etapa 1 não foi executado.
5. `401` = sessão/JWT; saia e entre novamente se a renovação automática não resolver.
6. Não limpe o localStorage enquanto houver uma fila pendente; ele é a camada de recuperação offline.

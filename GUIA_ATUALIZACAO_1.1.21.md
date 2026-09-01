# Atualização 1.1.21

## 1. Vercel
Suba o código completo da versão 1.1.21 no mesmo projeto do Constancce.

## 2. Supabase
Nenhum SQL novo é necessário.

Se você já publicou o `domain-sync` da 1.1.20, não precisa republicá-lo nesta atualização. A correção da 1.1.21 está no cliente e usa o mesmo contrato de API.

## 3. Teste rápido
- Abra `https://constancceapp.com`.
- Crie uma tarefa ou registre uma alteração de treino.
- Atualize a página: o registro deve permanecer.
- Abra a mesma conta em outro dispositivo: a alteração deve chegar após sincronização.
- Faça uma alteração e feche o app rapidamente. Ao reabrir, a fila local deve ser retomada automaticamente.

## 4. Observação
Dados que já tenham sido removidos tanto do Supabase quanto do cache local antes desta versão não podem ser recriados automaticamente. A 1.1.21 evita novas perdas e preserva filas ainda existentes no dispositivo.

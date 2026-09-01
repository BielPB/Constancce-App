# Contas com acesso vitalício gratuito

Estas contas não precisam pagar e não entram no trial:

- bielbarbosa187@gmail.com
- ellenmaria542@gmail.com

No Supabase elas ficam como:
- `plan = lifetime`
- `payment_status = complimentary`
- `payment_amount = 0`

Se o SQL de pagamento já foi executado anteriormente, execute novamente o arquivo
`SUPABASE_PAYMENT_SETUP.sql`. O script atualiza especificamente essas duas contas
sem remover os demais usuários nem seus dados.

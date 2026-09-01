# Constancce 1.1.19 — Tarefas com horário obrigatório + aviso 30 min antes

## Alterações

- Toda **nova tarefa** precisa ter horário para ser criada.
- A data continua sendo escolhida no formulário; a opção "Sem data" foi removida para garantir que o lembrete possa ser agendado.
- Tarefas antigas sem horário são preservadas. Ao editá-las pelo formulário, será necessário informar um horário.
- O campo de horário passou para a área principal do formulário e é marcado como **Horário obrigatório**.
- O relógio exibido dentro do campo usa `#FFFFFF`.
- Cada nova tarefa salva `reminderMinutes: 30`.
- O backend `domain-sync` rejeita criação de tarefa nova sem `taskTime`, inclusive se alguém manipular o frontend.
- O lembrete de tarefa 30 minutos antes passa a funcionar para **Free e PRO**.
- A notificação inclui título da tarefa, horário, prioridade, categoria, descrição e duração estimada quando informados.
- Resumos horários e repetição automática de tarefas atrasadas continuam como recursos PRO.

## Compatibilidade

Web Push depende da autorização do dispositivo/navegador.

- Android/Chrome/PWA: suporte normal após permitir notificações.
- iPhone/iPad: para Web Push, instale o Constancce na Tela de Início e permita notificações no PWA.

## Backend alterado

Reimplantar:

- `domain-sync`
- `send-due-notifications`

Não há SQL novo obrigatório para quem já instalou a estrutura de Web Push.

## Cron

Para aproximar o envio dos 30 minutos com boa precisão, altere o cron de `send-due-notifications` para:

```text
*/5 * * * *
```

A URL e o header `x-cron-secret` continuam os mesmos.

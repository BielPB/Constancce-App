// Setter "imediato" para o estado de dados do app.
//
// O app tem dezenas de mutações escritas como
//   setX((prev) => { const next = ...; persist({ x: next }); fireToast(...); return next; })
// Para o React, o updater deveria ser puro: ele pode rodá-lo durante a
// renderização e, em modo de desenvolvimento (StrictMode) ou em renderizações
// interrompidas, rodá-lo mais de uma vez; aí o salvamento, o aviso e o
// registro de atividade dentro dele rodavam em dobro ou no meio do render.
// Foi essa classe de problema que fazia a tarefa marcada "voltar".
//
// Este setter executa o updater NA HORA, uma única vez, a partir do valor
// mais recente (guardado numa ref que ele mesmo atualiza), e entrega ao React
// só o valor final. Chamadas seguidas no mesmo clique encadeiam certo, como
// num updater funcional, mas os efeitos colaterais acontecem uma vez, fora
// do render.
export function createEagerSetter(ref, commit) {
  return (nextOrUpdater) => {
    const next = typeof nextOrUpdater === "function" ? nextOrUpdater(ref.current) : nextOrUpdater;
    if (Object.is(next, ref.current)) return next; // nada mudou: não re-renderiza
    ref.current = next;
    commit(next);
    return next;
  };
}

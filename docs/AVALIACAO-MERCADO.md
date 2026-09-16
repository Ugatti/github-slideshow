# Avaliação de soluções de timesheet jurídico no mercado brasileiro

**Contexto:** Azeredo & Ugatti Advogados avalia adotar uma solução de mercado ou
desenvolver um sistema proprietário de controle de horas.
**Data da pesquisa:** setembro de 2026.

> **Sobre os preços citados.** TOTVS, Thomson Reuters (Legal One), CPJ-3C e
> Projuris Enterprise **não publicam tabela de preços** — todos trabalham com
> proposta sob consulta. Os valores abaixo vêm de páginas públicas de preço
> (quando existem), de reclamações e relatos de clientes e de comparativos
> setoriais. Servem para ordem de grandeza, **não como cotação**. Qualquer
> decisão de compra exige proposta formal, porque o preço de lista raramente é
> o preço final em venda B2B jurídica.

---

## 1. Resumo da recomendação

Para a maioria dos escritórios, **comprar é mais barato do que construir**. O
custo de licença some diante do custo de manter software próprio por anos. Este
projeto só se justifica sob três condições, que devem ser revisadas
periodicamente:

1. **O escopo real é pequeno.** O pedido é timesheet — lançar, controlar e
   faturar horas. Não é ERP jurídico. Os produtos de mercado cobram
   por uma suíte (processos, prazos, publicações, financeiro, documentos,
   CRM) da qual o timesheet é um módulo. Pagar a suíte para usar o módulo é o
   pior dos dois mundos.
2. **A base de usuários é estável e pequena.** O modelo de cobrança dominante é
   por usuário/mês. Ele penaliza justamente o que um escritório de médio porte
   faz: incluir estagiários e advogados associados que lançam poucas horas.
3. **Há quem mantenha.** Software próprio sem responsável é passivo, não ativo.

Se o escritório passar a precisar de controle de prazos, captura de
publicações, integração com tribunais ou emissão de NFS-e, **a conta vira** e a
recomendação passa a ser adotar um produto de mercado. Essa é a principal
ressalva a registrar.

---

## 2. Comparativo das soluções avaliadas

| Solução | Fornecedor | Perfil-alvo | Timesheet | Ordem de grandeza (indicativa) |
|---|---|---|---|---|
| **Legal One** | Thomson Reuters | Médios e grandes | Integrado às atividades; app móvel | Relatos de clientes: ~R$ 500/mês para 3 usuários, subindo ~R$ 100 por usuário adicional |
| **TOTVS Jurídico** (linha Sisjuri / Protheus) | TOTVS | Médios, grandes e dep. jurídicos | Timesheet + faturamento de honorários | Sob consulta; venda consultiva com implantação |
| **Projuris ADV** | Projuris | Pequenos e médios | Timesheet no módulo Financeiro, com cronômetro | Módulo Financeiro a partir de ~R$ 29,90/mês, somado ao plano-base |
| **Projuris Enterprise** | Projuris | Grandes e dep. jurídicos | Completo | Sob consulta |
| **Astrea** | Aurum | Autônomos e pequenos | Controle de horas por processo | Página pública: plano Up ~R$ 209/mês; ~R$ 895/mês para 5 advogados no plano Completo |
| **CPJ-3C** | Prêambulo | Médios e grandes | Timesheet + contábil + relatórios | Sob consulta |
| **ADVBox** | ADVBox | Pequenos e médios | Foco em produtividade e tarefas | Sob consulta |
| **Espaider** | Softplan | Grandes e dep. jurídicos | Completo | Sob consulta |
| **SAJ ADV** | Softplan | Pequenos e médios | Controle de horas | Sob consulta |

### Leitura por fornecedor

**Thomson Reuters — Legal One.** O nome mais forte da lista. Roda em Azure, tem
certificação SOC 1 Tipo II e aderência declarada à LGPD, e integra a gestão com
a base de jurisprudência da própria Thomson Reuters — diferencial real para
quem já assina esse conteúdo. O timesheet é nativo, com app móvel.
*Ponto de atenção:* há um volume relevante de reclamações públicas sobre
**cobrança na saída e dificuldade para reduzir usuários** — um cliente relata ter
sido cobrado por remover um usuário do sistema. Em contrato por usuário/mês,
a cláusula de redução de licenças importa tanto quanto o preço de entrada.

**TOTVS.** Mais de 54 mil usuários e 25 mil advogados nos sistemas jurídicos da
casa. A escolha natural de quem **já usa TOTVS no ERP**, porque a integração
com contas a pagar/receber e contabilidade vem pronta. Para um escritório que
não é cliente TOTVS, é peso desproporcional: venda consultiva, implantação e um
produto dimensionado para operação muito maior que a de um escritório de
advocacia de médio porte.

**Projuris ADV.** A melhor relação custo/benefício da lista para o problema
específico. O timesheet está no módulo Financeiro, com cronômetro que registra
o tempo direto no lançamento, e o custo declarado do módulo é baixo — embora ele
seja adicional ao plano-base, e o preço final dependa do número de usuários. A
Projuris ainda distribui **planilha de timesheet gratuita**, o que diz algo
sobre a maturidade da demanda. É o benchmark contra o qual este projeto deve
ser comparado.

**Astrea (Aurum).** Melhor usabilidade da categoria e o único com preço
totalmente público. Foi desenhado para advogado autônomo e escritório pequeno;
o controle de horas existe, mas é acessório ao acompanhamento processual. Para
um escritório que quer **faturamento por hora como eixo central**, fica curto.

**CPJ-3C.** Robusto, muito usado em escritórios médios e grandes, com timesheet
integrado à contabilidade. É a alternativa séria ao Legal One quando o critério
é profundidade de gestão, não conteúdo jurídico.

**ADVBox, Espaider, SAJ ADV.** Bons produtos, mas nenhum tem no timesheet o seu
centro de gravidade: ADVBox mira produtividade e delegação de tarefas; Espaider
e SAJ ADV são plataformas amplas de contencioso.

---

## 3. O que pesou na decisão de construir

| Critério | Solução de mercado | Sistema proprietário |
|---|---|---|
| **Custo inicial** | Baixo (assinatura) | Alto (desenvolvimento) |
| **Custo em 5 anos** | Cresce com a equipe | Praticamente fixo (hospedagem) |
| **Prazo para usar** | Dias | Semanas |
| **Aderência ao processo do escritório** | Adapta-se o escritório ao software | Adapta-se o software ao escritório |
| **Cobrança por usuário** | Sim — desestimula incluir estagiários | Não |
| **Propriedade dos dados** | Do fornecedor; exportação conforme contrato | Integral, em banco próprio |
| **Risco de dependência** | Alto (migração é cara e dolorosa) | Baixo |
| **Risco de manutenção** | Do fornecedor | **Do escritório** |
| **Prazos, publicações, tribunais** | Incluídos | **Não existem** |
| **Emissão de NFS-e** | Em alguns produtos | **Não existe** — o sistema gera a memória de cálculo, a nota sai fora |

**O ponto decisivo:** a cobrança por usuário/mês cria um incentivo perverso.
Quando cada novo estagiário custa licença, a tendência é deixá-lo de fora — e
timesheet com cobertura parcial não serve para faturar nem para medir
rentabilidade. Um sistema próprio remove esse atrito: incluir todo mundo é
custo zero.

**O que se abre mão:** controle de prazos, captura automática de publicações,
integração com tribunais, emissão de nota fiscal e suporte de fornecedor. Se
algum desses itens virar necessidade, a análise deve ser refeita — e o caminho
provável é Projuris ADV ou Legal One.

---

## 4. Requisitos que o sistema proprietário atende

Do pedido original:

- **Duas classes de conta.** `master` (acesso às horas de todos os
  profissionais, administração de cadastros e extração de relatórios para nota
  fiscal) e `user` (profissionais do escritório).
- **Seleção de cliente e projeto** no lançamento de horas.
- **Cada pessoa inclui e exclui as próprias horas.**
- **A conta master inclui e exclui horas de todos.**
- **Relatórios para uso em notas fiscais**, com memória de cálculo por projeto e
  por profissional, exportação em CSV e versão para impressão/PDF.

Decisões de projeto que não estavam no pedido, mas que a prática de faturamento
por hora exige:

- **Congelamento do valor/hora no lançamento.** Reajustar a tabela de
  honorários não pode reescrever relatórios já emitidos.
- **Fechamento de período.** Horas que lastreiam uma nota emitida ficam
  bloqueadas contra edição e exclusão, com reabertura possível e auditada.
- **Trilha de auditoria.** Registra quem lançou, alterou e excluiu — inclusive o
  conteúdo do que foi apagado. Necessária para sustentar o faturamento em caso
  de questionamento do cliente e alinhada ao princípio da responsabilização
  (art. 6º, X, da LGPD).
- **Arquivamento em vez de exclusão** de clientes, projetos e usuários com
  histórico de horas.

---

## 5. Revisão periódica

Recomenda-se reavaliar esta decisão **anualmente**, ou imediatamente se:

- o escritório passar a precisar de controle de prazos ou captura de publicações;
- o número de profissionais crescer a ponto de exigir perfis intermediários
  (sócio de área, coordenador) além de master/user;
- deixar de haver quem mantenha o sistema;
- surgir exigência de integração contábil ou de emissão automática de NFS-e.

---

## Fontes

- [Projuris ADV — Módulo Financeiro (timesheet)](https://store.projuris.com.br/products/financeiro-projuris-adv)
- [Projuris ADV — Planilha de Timesheet](https://promo.projuris.com.br/timesheet)
- [Projuris ADV — página do produto](https://www.projuris.com.br/adv/)
- [Thomson Reuters — Legal One para escritórios](https://www.thomsonreuters.com.br/pt/juridico/legal-one/firm.html)
- [Thomson Reuters — pacotes Legal One](https://www.thomsonreuters.com.br/pt/juridico/legal-one/firm/pacotes.html)
- [Reclame Aqui — relato de cobrança no cancelamento de usuário do Legal One](https://www.reclameaqui.com.br/thomson-reuters/thomson-reuters-cobranca-abusiva-e-desrespeito-no-cancelamento-de-usuario-do-sistema-legal-one_5T_ZpEUmx1rk5FMA/)
- [TOTVS Jurídico — escritórios de advocacia](https://www.totvs.com/juridico/escritorios-de-advocacia/)
- [TOTVS Gestão Jurídica — linha Sisjuri](https://produtos.totvs.com/juridico/totvs-gestao-juridica-linha-sisjuri/novidades-em-novembro-de-2022/)
- [Aurum — planos e preços do Astrea](https://www.aurum.com.br/astrea/planos-e-precos/)
- [Comparativo de sistemas para escritórios 2026 (CPJ, Astrea, Projuris)](https://ialocus.com.br/blog/post-sistema-advocacia-lgpd-cpj-astrea-projuris-2026.html)
- [Ranking de softwares jurídicos 2026](https://asquadz.ai/blog/softwares-gestao-juridica-comparativo/)
- [CPJ-3C — ficha do produto](https://buscajur.com.br/cpj-3c/)

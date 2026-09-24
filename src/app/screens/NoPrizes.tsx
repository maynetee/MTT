import { useI18n } from "../../i18n";
import { ButtonLink } from "../components/Button";
import { EmptyState } from "../components/EmptyState";
import { useTournament } from "../TournamentContext";

/** The Payouts and Deal tabs of a tournament that pays no prizes (reached by their address). */
export function NoPrizes() {
  const { t } = useI18n();
  const { id } = useTournament();
  return (
    <EmptyState
      icon="info"
      title={t("payouts.noPrizes")}
      description={t("payouts.noPrizesHint")}
      action={<ButtonLink to={`/t/${encodeURIComponent(id)}/settings`}>{t("tabs.settings")}</ButtonLink>}
    />
  );
}

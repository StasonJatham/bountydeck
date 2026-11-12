import {
  finalizeAwardSeason,
  reconcileAwardHistory,
  saveRecognition,
  saveReproducibility,
} from "../app/(portal)/achievements/review-actions";
import catalog from "../lib/achievements/catalog.json";
import { Field, input, panel, Text } from "../lib/forms";
import { getI18n } from "../lib/i18n";
import { Button } from "./ui/button";

export async function AchievementReview({
  reportId,
  reproVerified,
  canVerify,
  canGrant,
  manualAwards,
  result,
}: {
  reportId: string;
  reproVerified: boolean;
  canVerify: boolean;
  canGrant: boolean;
  manualAwards: string[];
  result?: string;
}) {
  const { t } = await getI18n();
  const badges = catalog.badges.filter(
    ({ rule }) => rule.type === "manual_award",
  );
  const available = badges.filter(({ id }) => !manualAwards.includes(id));
  const granted = badges.filter(({ id }) => manualAwards.includes(id));
  const choices = [
    ...(canGrant && available.length
      ? [{ operation: "grant", badges: available }]
      : []),
    ...(granted.length ? [{ operation: "revoke", badges: granted }] : []),
  ];
  if (!canVerify && !choices.length) return null;

  return (
    <section className={`${panel} space-y-4`}>
      <h2 className="font-semibold">{t("Researcher recognition")}</h2>
      <AchievementResult result={result} />
      {canVerify && (
        <form
          className="grid gap-3"
          action={saveReproducibility.bind(null, reportId)}
        >
          <Field label={t("Reproducibility")}>
            <select
              className={input}
              name="verified"
              defaultValue={String(reproVerified)}
            >
              <option value="false">{t("Unverified")}</option>
              <option value="true">{t("Verified by triage")}</option>
            </select>
          </Field>
          <Button variant="outline">{t("Save reproducibility")}</Button>
        </form>
      )}
      {choices.map(({ operation, badges }) => (
        <form
          className="grid gap-3 border-t border-line pt-4"
          action={saveRecognition.bind(null, reportId)}
          key={operation}
        >
          <input type="hidden" name="operation" value={operation} />
          <Field
            label={t(
              operation === "grant" ? "Award to grant" : "Award to revoke",
            )}
          >
            <select className={input} name="badgeId">
              {badges.map(({ id, name }) => (
                <option key={id} value={id}>
                  {t(name)}
                </option>
              ))}
            </select>
          </Field>
          <Text name="reason" label={t("Reason")} max={500} multiline />
          <Button variant="outline">
            {t(
              operation === "grant"
                ? "Grant recognition"
                : "Revoke recognition",
            )}
          </Button>
        </form>
      ))}
    </section>
  );
}

export async function AchievementAdministration({
  result,
}: {
  result?: string;
}) {
  const { t } = await getI18n();
  return (
    <section className={`${panel} space-y-4`}>
      <h2 className="font-semibold">{t("Achievement administration")}</h2>
      <AchievementResult result={result} />
      <form className="grid gap-3" action={finalizeAwardSeason}>
        <h3 className="text-sm font-semibold">
          {t("Finalize season rankings")}
        </h3>
        <Field label={t("Season period")}>
          <select name="period" className={input}>
            <option value="quarter">{t("quarter")}</option>
            <option value="year">{t("year")}</option>
          </select>
        </Field>
        <Field label={t("First day of the season (UTC)")}>
          <input className={input} type="date" name="startsOn" required />
        </Field>
        <Button variant="outline">{t("Finalize season")}</Button>
      </form>
      <form
        className="grid gap-3 border-t border-line pt-4"
        action={reconcileAwardHistory}
      >
        <p className="text-sm text-muted">
          {t("Recheck lifetime badges against historical reports and scores.")}
        </p>
        <Button variant="outline">{t("Reconcile achievements")}</Button>
      </form>
    </section>
  );
}

async function AchievementResult({ result }: { result?: string }) {
  const { t } = await getI18n();
  if (result === "error") {
    return (
      <p role="alert" className="text-sm text-danger">
        {t(
          "The achievement change could not be saved. Check the details and try again.",
        )}
      </p>
    );
  }
  if (result === "saved") {
    return (
      <p role="status" className="text-sm text-success">
        {t("Achievement change saved.")}
      </p>
    );
  }
  return null;
}

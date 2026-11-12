import { Button } from "./ui/button";
import { Field, input, panel, Text } from "../lib/forms";
import { getI18n } from "../lib/i18n";
import { severities } from "../lib/workflow";

export async function ReportForm({
  action,
  assets,
  error,
}: {
  action: (data: FormData) => Promise<void>;
  assets: { id: string; name: string }[];
  error?: string;
}) {
  const { t } = await getI18n();
  return (
    <form
      id="submit-report"
      tabIndex={-1}
      action={action}
      className={`${panel} grid scroll-mt-20 content-start gap-4 [&_textarea[name=proofOfConcept]]:font-mono [&_textarea[name=steps]]:font-mono`}
    >
      <h2 className="text-xl font-semibold">{t("Submit a report")}</h2>
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error === "rate-limit"
            ? t("Submission limit reached. Try again later.")
            : t("Check the report fields and try again.")}
        </p>
      )}
      <Text name="title" label={t("Title")} />
      <Field label={t("Affected asset")}>
        <select className={input} name="assetId" required>
          {assets.map((asset) => (
            <option key={asset.id} value={asset.id}>
              {asset.name}
            </option>
          ))}
        </select>
      </Field>
      <Text name="cwe" label={t("Weakness (e.g. CWE-200)")} max={9} />
      <Field label={t("Proposed severity")}>
        <select className={input} name="proposedSeverity">
          {severities.map((severity) => (
            <option key={severity} value={severity}>
              {t(severity)}
            </option>
          ))}
        </select>
      </Field>
      <Text name="description" label={t("Description")} multiline max={12000} />
      <Text
        name="steps"
        label={t("Reproduction steps")}
        multiline
        max={12000}
      />
      <Text
        name="proofOfConcept"
        label={t("Proof of concept")}
        multiline
        max={12000}
      />
      <Text name="impact" label={t("Impact")} multiline max={12000} />
      <Button>{t("Submit report")}</Button>
    </form>
  );
}

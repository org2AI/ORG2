import { useTranslation } from "react-i18next";

import loginFailure from "@src/assets/illustrations/login-failure.png";
import loginMarket from "@src/assets/illustrations/login-market.png";
import loginMobileRemote from "@src/assets/illustrations/login-mobile-remote.png";
import loginSharing from "@src/assets/illustrations/login-sharing.png";
import loginSuccess from "@src/assets/illustrations/login-success.png";
import loginWaiting from "@src/assets/illustrations/login-waiting.png";
import onboarding from "@src/assets/illustrations/onboarding.png";
import quit from "@src/assets/illustrations/quit.png";
import signOut from "@src/assets/illustrations/sign-out.png";
import update from "@src/assets/illustrations/update.png";
import Illustration from "@src/components/Illustration";

import "./IllustrationPreview.scss";

const illustrations = [
  ["sign-out", signOut],
  ["login-waiting", loginWaiting],
  ["login-success", loginSuccess],
  ["login-failure", loginFailure],
  ["login-sharing", loginSharing],
  ["login-market", loginMarket],
  ["login-mobile-remote", loginMobileRemote],
  ["onboarding", onboarding],
  ["quit", quit],
  ["update", update],
] as const;

export default function IllustrationPreview() {
  const { t } = useTranslation("settings");
  return (
    <div className="flex flex-col gap-6">
      <p className="text-sm text-text-3">
        {t("development.illustrationsDesc")}
      </p>
      {illustrations.map(([name, src]) => (
        <section key={name} aria-label={`${name}.png`} className="min-w-0">
          <h3 className="mb-2 font-mono text-sm text-text-2">{name}.png</h3>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {(["light", "dark"] as const).map((theme) => (
              <figure
                key={theme}
                data-preview-theme={theme}
                className="illustration-preview-surface overflow-hidden rounded-xl border border-border-2"
              >
                <figcaption className="px-4 pt-3 text-sm font-medium">
                  {t(`general.${theme}`)}
                </figcaption>
                <Illustration
                  src={src}
                  theme={theme}
                  loading="lazy"
                  className="block aspect-3/2 w-full"
                />
              </figure>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

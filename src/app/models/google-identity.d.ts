interface GoogleIdentityCredentialResponse {
  credential: string;
}

interface GoogleIdentityPromptNotification {
  isNotDisplayed(): boolean;
  isSkippedMoment(): boolean;
}

interface Window {
  google?: {
    accounts: {
      id: {
        initialize(configuration: {
          client_id: string;
          callback: (response: GoogleIdentityCredentialResponse) => void;
        }): void;
        prompt(callback?: (notification: GoogleIdentityPromptNotification) => void): void;
      };
    };
  };
}

const passkeySignIn = async () => {
  setErr("");
  setBusy("passkey");

  try {
    const { attemptId, options: rawOptions } =
      await api.passkeyLoginOptions();

    const options = {
      ...rawOptions,
      allowCredentials: Array.isArray(rawOptions?.allowCredentials)
        ? rawOptions.allowCredentials
        : [],
    };

    const response = await startAuthentication({
      optionsJSON: options,
    });

    const res = await api.passkeyLoginVerify({
      attemptId,
      response,
    });

    setToken(res.token);
    onDone(res.user);
  } catch (e) {
    if (e?.name !== "NotAllowedError") {
      setErr(
        e.message || "Couldn't sign in with that passkey."
      );
    }
  } finally {
    setBusy(null);
  }
};
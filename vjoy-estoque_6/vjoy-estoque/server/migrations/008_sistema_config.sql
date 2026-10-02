-- Configurações do sistema. "base_versao" muda quando o administrador zera os dados de teste:
-- os celulares percebem e descartam leituras/cópias guardadas que eram da base antiga.
CREATE TABLE IF NOT EXISTS sistema_config (
  chave TEXT PRIMARY KEY,
  valor TEXT NOT NULL,
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO sistema_config(chave, valor) VALUES ('base_versao', md5(random()::text)) ON CONFLICT DO NOTHING;

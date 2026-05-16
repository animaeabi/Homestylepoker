do $$
begin
  if to_regprocedure('public.gen_random_bytes(integer)') is null then
    execute $fn$
      create function public.gen_random_bytes(p_len integer)
      returns bytea
      language plpgsql
      volatile
      set search_path = pg_catalog, public, extensions, pg_temp
      as $body$
      declare
        v_bytes bytea;
        v_hex text := '';
      begin
        if p_len is null or p_len < 0 then
          raise exception 'invalid_byte_length';
        end if;

        begin
          execute 'select extensions.gen_random_bytes($1)' into v_bytes using p_len;
          return v_bytes;
        exception
          when undefined_function or invalid_schema_name then
            null;
        end;

        while length(v_hex) < p_len * 2 loop
          v_hex := v_hex || replace(gen_random_uuid()::text, '-', '');
        end loop;

        return decode(substr(v_hex, 1, p_len * 2), 'hex');
      end;
      $body$;
    $fn$;
  end if;
end
$$;

do $$
begin
  if to_regprocedure('public.digest(bytea,text)') is null then
    execute $fn$
      create function public.digest(p_data bytea, p_type text)
      returns bytea
      language plpgsql
      stable
      set search_path = pg_catalog, public, extensions, pg_temp
      as $body$
      declare
        v_out bytea;
      begin
        begin
          execute 'select extensions.digest($1, $2)' into v_out using p_data, p_type;
          return v_out;
        exception
          when undefined_function or invalid_schema_name then
            null;
        end;

        raise exception 'pgcrypto_digest_unavailable';
      end;
      $body$;
    $fn$;
  end if;
end
$$;

do $$
begin
  if to_regprocedure('public.pgp_sym_encrypt(text,text,text)') is null then
    execute $fn$
      create function public.pgp_sym_encrypt(p_data text, p_key text, p_options text)
      returns bytea
      language plpgsql
      stable
      set search_path = pg_catalog, public, extensions, pg_temp
      as $body$
      declare
        v_out bytea;
      begin
        begin
          execute 'select extensions.pgp_sym_encrypt($1, $2, $3)' into v_out using p_data, p_key, p_options;
          return v_out;
        exception
          when undefined_function or invalid_schema_name then
            null;
        end;

        raise exception 'pgcrypto_pgp_sym_encrypt_unavailable';
      end;
      $body$;
    $fn$;
  end if;
end
$$;

do $$
begin
  if to_regprocedure('public.pgp_sym_decrypt(bytea,text)') is null then
    execute $fn$
      create function public.pgp_sym_decrypt(p_data bytea, p_key text)
      returns text
      language plpgsql
      stable
      set search_path = pg_catalog, public, extensions, pg_temp
      as $body$
      declare
        v_out text;
      begin
        begin
          execute 'select extensions.pgp_sym_decrypt($1, $2)' into v_out using p_data, p_key;
          return v_out;
        exception
          when undefined_function or invalid_schema_name then
            null;
        end;

        raise exception 'pgcrypto_pgp_sym_decrypt_unavailable';
      end;
      $body$;
    $fn$;
  end if;
end
$$;

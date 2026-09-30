-- Optional seed examples for manual enrichment.
-- Run after schema.sql.

insert into media (id,name,slug,media_type,territory,priority,active)
values
('presse_ocean','Presse Océan','presse-ocean','regional_daily',array['Loire-Atlantique'],5,true),
('ouest_france_continu','Ouest-France','ouest-france','regional_daily',array['Loire-Atlantique','Grand Ouest'],5,true),
('france3_nantes','France 3 Pays de la Loire — Nantes','france3-nantes','public_tv_web',array['Nantes'],5,true),
('ici_loire_ocean','ICI Loire Océan','ici-loire-ocean','public_radio_web',array['Loire-Atlantique','Vendée'],5,true),
('actu44','Actu44','actu44','pure_player',array['Loire-Atlantique'],5,true)
on conflict (id) do nothing;

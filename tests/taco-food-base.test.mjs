import test from "node:test";
import assert from "node:assert/strict";
import { parseTacoCsv, tacoRowsToFoods } from "../src/data/tacoFoodBase.js";

const sample = `numero_alimento,descricao,umidade_pct,energia_kcal,energia_kj,proteina_g,lipideos_g,colesterol_mg,carboidrato_g,fibra_g,cinzas_g,calcio_mg,magnesio_mg,manganes_mg,fosforo_mg,ferro_mg,sodio_mg,potassio_mg,cobre_mg,zinco_mg,retinol_mcg,RE_mcg,RAE_mcg,tiamina_mg,riboflavina_mg,piridoxina_mg,niacina_mg,vitamina_c_mg,categoria
1,"Arroz, integral, cozido",70.1,123.5,516.8,2.58,1.0,,25.8,2.74,,,,,,,1.24,,,,,,,,,,,,"Cereais e derivados"
2,"Frango, peito, sem pele, grelhado",63.8,159.1,665.6,32.0,2.5,,0,0,,,,,,,50,,,,,,,,,,,,"Carnes e derivados"
`;

test("parser TACO preserva descrições com vírgula", () => {
  const rows = parseTacoCsv(sample);
  assert.equal(rows.length, 3);
  assert.equal(rows[1][1], "Arroz, integral, cozido");
});

test("TACO é convertido para o schema da Dieta", () => {
  const foods = tacoRowsToFoods(parseTacoCsv(sample));
  assert.equal(foods.length, 2);
  assert.equal(foods[0].source, "taco");
  assert.equal(foods[0].baseQuantity, 100);
  assert.equal(foods[0].calories, 123.5);
  assert.equal(foods[0].protein, 2.6);
  assert.equal(foods[0].sugarAvailable, false);
  assert.match(foods[0].sourceLabel, /TACO/);
});
